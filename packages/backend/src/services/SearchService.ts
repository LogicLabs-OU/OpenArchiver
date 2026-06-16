import { Index, MeiliSearch, SearchParams } from 'meilisearch';
import { config } from '../config';
import type {
	SearchQuery,
	SearchResult,
	EmailDocument,
	SearchHit,
	TopSender,
	User,
} from '@open-archiver/types';
import { FilterBuilder } from './FilterBuilder';
import { AuditService } from './AuditService';
import { IngestionService } from './IngestionService';

const FIELD_SEARCH_ATTRIBUTES = new Set([
	'subject',
	'body',
	'attachments.filename',
	'attachments.content',
]);

export class SearchService {
	private client: MeiliSearch;
	private auditService: AuditService;

	constructor() {
		this.client = new MeiliSearch({
			host: config.search.host,
			apiKey: config.search.apiKey,
		});
		this.auditService = new AuditService();
	}

	public async getIndex<T extends Record<string, any>>(name: string): Promise<Index<T>> {
		return this.client.index<T>(name);
	}

	public async addDocuments<T extends Record<string, any>>(
		indexName: string,
		documents: T[],
		primaryKey?: string
	) {
		const index = await this.getIndex<T>(indexName);
		if (primaryKey) {
			index.update({ primaryKey });
		}
		return index.addDocuments(documents);
	}

	public async search<T extends Record<string, any>>(
		indexName: string,
		query: string,
		options?: any
	) {
		const index = await this.getIndex<T>(indexName);
		return index.search(query, options);
	}

	public async deleteDocuments(indexName: string, ids: string[]) {
		const index = await this.getIndex(indexName);
		return index.deleteDocuments(ids);
	}

	public async deleteDocumentsByFilter(indexName: string, filter: string | string[]) {
		const index = await this.getIndex(indexName);
		return index.deleteDocuments({ filter });
	}

	public async searchEmails(
		dto: SearchQuery,
		userId: string,
		actorIp: string
	): Promise<SearchResult> {
		const {
			query,
			filters,
			attributesToSearchOn,
			fieldQueries,
			page = 1,
			limit = 10,
			matchingStrategy = 'last',
		} = dto;
		const index = await this.getIndex<EmailDocument>('emails');

		const searchParams: SearchParams = {
			attributesToHighlight: ['*'],
			showMatchesPosition: true,
			sort: ['timestamp:desc'],
			matchingStrategy,
		};

		if (attributesToSearchOn?.length) {
			searchParams.attributesToSearchOn = attributesToSearchOn;
		}

		const filter = await this.buildFilter(filters, userId);
		if (filter) {
			searchParams.filter = filter;
		}

		let hits: SearchHit[];
		let total: number;
		let processingTimeMs: number;

		const safeFieldQueries = this.getSafeFieldQueries(fieldQueries);

		if (safeFieldQueries.length === 1 && !query) {
			const fieldQuery = safeFieldQueries[0];
			const searchResults = await index.search(fieldQuery.query, {
				...searchParams,
				attributesToSearchOn: [fieldQuery.attribute],
				limit,
				offset: (page - 1) * limit,
			});
			hits = searchResults.hits;
			total = searchResults.estimatedTotalHits ?? searchResults.hits.length;
			processingTimeMs = searchResults.processingTimeMs;
		} else if (safeFieldQueries.length) {
			const advancedResults = await this.searchWithFieldQueries(
				index,
				query,
				safeFieldQueries,
				searchParams,
				page,
				limit
			);
			hits = advancedResults.hits;
			total = advancedResults.total;
			processingTimeMs = advancedResults.processingTimeMs;
		} else {
			const searchResults = await index.search(query, {
				...searchParams,
				limit,
				offset: (page - 1) * limit,
			});
			hits = searchResults.hits;
			total = searchResults.estimatedTotalHits ?? searchResults.hits.length;
			processingTimeMs = searchResults.processingTimeMs;
		}

		await this.auditService.createAuditLog({
			actorIdentifier: userId,
			actionType: 'SEARCH',
			targetType: 'ArchivedEmail',
			targetId: '',
			actorIp,
			details: {
				query,
				filters,
				page,
				limit,
				matchingStrategy,
				attributesToSearchOn,
				fieldQueries: safeFieldQueries,
			},
		});

		return {
			hits,
			total,
			page,
			limit,
			totalPages: Math.ceil(total / limit),
			processingTimeMs,
		};
	}

	private getSafeFieldQueries(
		fieldQueries: SearchQuery['fieldQueries']
	): NonNullable<SearchQuery['fieldQueries']> {
		return (fieldQueries ?? []).filter((fieldQuery) =>
			FIELD_SEARCH_ATTRIBUTES.has(fieldQuery.attribute)
		);
	}

	private async buildFilter(
		filters: SearchQuery['filters'],
		userId: string
	): Promise<string | undefined> {
		const filterParts: string[] = [];

		if (filters) {
			for (const [key, value] of Object.entries(filters)) {
				// Expand ingestionSourceId to the full merge group
				if (key === 'ingestionSourceId' && typeof value === 'string') {
					const groupIds = await IngestionService.findGroupSourceIds(value);
					if (groupIds.length === 1) {
						filterParts.push(
							`ingestionSourceId = '${this.escapeFilterValue(groupIds[0])}'`
						);
					} else {
						const inList = groupIds
							.map((id) => `'${this.escapeFilterValue(id)}'`)
							.join(', ');
						filterParts.push(`ingestionSourceId IN [${inList}]`);
					}
				} else if (key === 'timestamp' && typeof value === 'object' && value !== null) {
					const range = value as { from?: number; to?: number };
					if (typeof range.from === 'number') {
						filterParts.push(`timestamp >= ${range.from}`);
					}
					if (typeof range.to === 'number') {
						filterParts.push(`timestamp <= ${range.to}`);
					}
				} else if (typeof value === 'string') {
					filterParts.push(`${key} = '${this.escapeFilterValue(value)}'`);
				} else {
					filterParts.push(`${key} = ${value}`);
				}
			}
		}

		// Create a filter based on the user's permissions.
		// This ensures that the user can only search for emails they are allowed to see.
		const { searchFilter } = await FilterBuilder.create(userId, 'archive', 'read');
		if (searchFilter) {
			filterParts.push(searchFilter);
		}

		return filterParts.length ? filterParts.join(' AND ') : undefined;
	}

	private async searchWithFieldQueries(
		index: Index<EmailDocument>,
		query: string,
		fieldQueries: NonNullable<SearchQuery['fieldQueries']>,
		searchParams: SearchParams,
		page: number,
		limit: number
	): Promise<Pick<SearchResult, 'hits' | 'total' | 'processingTimeMs'>> {
		const maxCandidates = 1000;
		const searches = [
			...(query ? [{ query, attributesToSearchOn: searchParams.attributesToSearchOn }] : []),
			...fieldQueries.map((fieldQuery) => ({
				query: fieldQuery.query,
				attributesToSearchOn: [fieldQuery.attribute],
			})),
		];

		const results = await Promise.all(
			searches.map((search) =>
				index.search(search.query, {
					...searchParams,
					attributesToSearchOn: search.attributesToSearchOn,
					limit: maxCandidates,
					offset: 0,
				})
			)
		);

		const idSets = results.map((result) => new Set(result.hits.map((hit) => String(hit.id))));
		const primaryResult = results.reduce((smallest, result) => {
			const smallestTotal = smallest.estimatedTotalHits ?? smallest.hits.length;
			const resultTotal = result.estimatedTotalHits ?? result.hits.length;
			return resultTotal < smallestTotal ? result : smallest;
		}, results[0]);

		const matchedHits = primaryResult.hits.filter((hit) =>
			idSets.every((idSet) => idSet.has(String(hit.id)))
		);
		const offset = (page - 1) * limit;

		return {
			hits: matchedHits.slice(offset, offset + limit),
			total: matchedHits.length,
			processingTimeMs: results.reduce(
				(totalMs, result) => totalMs + result.processingTimeMs,
				0
			),
		};
	}

	private escapeFilterValue(value: string): string {
		return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
	}

	public async getTopSenders(limit = 10): Promise<TopSender[]> {
		const index = await this.getIndex<EmailDocument>('emails');
		const searchResults = await index.search('', {
			facets: ['from'],
			limit: 0,
		});

		if (!searchResults.facetDistribution?.from) {
			return [];
		}

		// Sort and take top N
		const sortedSenders = Object.entries(searchResults.facetDistribution.from)
			.sort(([, countA], [, countB]) => countB - countA)
			.slice(0, limit)
			.map(([sender, count]) => ({ sender, count }));

		return sortedSenders;
	}

	public async configureEmailIndex() {
		const index = await this.getIndex('emails');
		await index.updateSettings({
			searchableAttributes: [
				'subject',
				'body',
				'from',
				'to',
				'cc',
				'bcc',
				'attachments.filename',
				'attachments.content',
				'userEmail',
			],
			filterableAttributes: [
				'from',
				'to',
				'cc',
				'bcc',
				'timestamp',
				'ingestionSourceId',
				'userEmail',
			],
			sortableAttributes: ['timestamp'],
		});
	}
}
