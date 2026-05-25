import { Index, MeiliSearch, SearchParams } from 'meilisearch';
import { config } from '../config';
import type {
	SearchQuery,
	SearchResult,
	EmailDocument,
	TopSender,
	User,
} from '@open-archiver/types';
import { FilterBuilder } from './FilterBuilder';
import { AuditService } from './AuditService';
import { translateFilters } from './search/filterTranslator';

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
		const { query, filters, sort, page = 1, limit = 10, matchingStrategy = 'last' } = dto;
		const index = await this.getIndex<EmailDocument>('emails');

		const sortParam = sort && sort.length > 0
			? sort.map((s) => `${s.field}:${s.dir}`)
			: ['timestamp:desc'];

		const searchParams: SearchParams = {
			limit,
			offset: (page - 1) * limit,
			attributesToHighlight: ['*'],
			showMatchesPosition: true,
			sort: sortParam,
			matchingStrategy,
		};

		// Typed filter translation. Throws FilterValidationError on unknown
		// field / disallowed op / bad shape — the controller maps that to a 400.
		const userFilter = await translateFilters(filters);
		if (userFilter) {
			searchParams.filter = userFilter;
		}

		// Append CASL access-control filter. Note: the CASL translator
		// (`mongoToMeli`) emits double-quoted string literals while our
		// `translateFilters` emits single-quoted ones — Meilisearch accepts
		// both, so the AND-join below is safe.
		const { searchFilter } = await FilterBuilder.create(userId, 'archive', 'read');
		if (searchFilter) {
			if (searchParams.filter) {
				searchParams.filter = `${searchParams.filter} AND ${searchFilter}`;
			} else {
				searchParams.filter = searchFilter;
			}
		}

		const searchResults = await index.search(query ?? '', searchParams);

		await this.auditService.createAuditLog({
			actorIdentifier: userId,
			actionType: 'SEARCH',
			targetType: 'ArchivedEmail',
			targetId: '',
			actorIp,
			details: {
				query,
				filters,
				sort: sortParam,
				appliedFilter: searchParams.filter ?? null,
				page,
				limit,
				matchingStrategy,
			},
		});

		return {
			hits: searchResults.hits,
			total: searchResults.estimatedTotalHits ?? searchResults.hits.length,
			page,
			limit,
			totalPages: Math.ceil(
				(searchResults.estimatedTotalHits ?? searchResults.hits.length) / limit
			),
			processingTimeMs: searchResults.processingTimeMs,
		};
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
