import { Index, MeiliSearch, SearchParams } from 'meilisearch';
import { config } from '../config';
import type { SearchQuery, SearchResult, EmailDocument, TopSender } from '@open-archiver/types';

export class SearchService {
	private client: MeiliSearch;

	constructor() {
		this.client = new MeiliSearch({
			host: config.search.host,
			apiKey: config.search.apiKey,
		});
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

	public async searchEmails(dto: SearchQuery): Promise<SearchResult> {
		const { query, filters, page = 1, limit = 10, matchingStrategy = 'last' } = dto;
		const index = await this.getIndex<EmailDocument>('emails');

		const searchParams: SearchParams = {
			limit,
			offset: (page - 1) * limit,
			attributesToHighlight: ['*'],
			showMatchesPosition: true,
			sort: ['timestamp:desc'],
			matchingStrategy,
		};

		if (filters) {
			const filterStrings = Object.entries(filters).map(([key, value]) => {
				if (typeof value === 'string') {
					return `${key} = '${value}'`;
				}
				return `${key} = ${value}`;
			});
			searchParams.filter = filterStrings.join(' AND ');
		}

		const searchResults = await index.search(query, searchParams);

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
			],
			filterableAttributes: ['from', 'to', 'cc', 'bcc', 'timestamp', 'ingestionSourceId'],
			sortableAttributes: ['timestamp'],
		});
	}
}
