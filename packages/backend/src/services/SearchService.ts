import { Index, MeiliSearch, SearchParams, type TaskType } from 'meilisearch';
import { config } from '../config';
import type {
	SearchQuery,
	SearchResult,
	EmailDocument,
	TopSender,
	User,
	SearchInstanceOverview,
	SearchIndexInfo,
	SearchTasksResult,
	SearchTaskStatus,
	SearchTaskType,
} from '@open-archiver/types';
import { FilterBuilder } from './FilterBuilder';
import { AuditService } from './AuditService';
import { IngestionService } from './IngestionService';
import { logger } from '../config/logger';
import { db } from '../database';
import { archivedEmails } from '../database/schema';
import { and, inArray, isNotNull } from 'drizzle-orm';

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

	/**
	 * Enqueues documents into a Meilisearch index and returns the EnqueuedTask.
	 * NOTE: this only queues the write — call waitForTask() with the returned
	 * task's uid to confirm the documents were actually indexed. The primary key
	 * is set once at index creation (configureEmailIndex), not per call.
	 */
	public async addDocuments<T extends Record<string, any>>(
		indexName: string,
		documents: T[],
		primaryKey?: string
	) {
		const index = await this.getIndex<T>(indexName);
		return index.addDocuments(documents, primaryKey ? { primaryKey } : undefined);
	}

	/**
	 * Waits for a Meilisearch task to reach a terminal state and returns it.
	 * Throws if the task fails or the wait times out — callers rely on this to
	 * fail their job so BullMQ retries instead of silently reporting success.
	 */
	public async waitForTask(taskUid: number) {
		return this.client.tasks.waitForTask(taskUid, {
			timeout: config.meili.waitForTaskTimeoutMs,
		});
	}

	/**
	 * Number of documents currently present in an index (exact).
	 */
	public async getIndexedCount(indexName: string): Promise<number> {
		const index = await this.getIndex(indexName);
		const stats = await index.getStats();
		return stats.numberOfDocuments;
	}

	/**
	 * Instance-level overview of the search engine for the admin index page:
	 * host, version, health, database size, and the `emails` index metadata.
	 * Never exposes the API key. Best-effort — a failing sub-call degrades that
	 * field rather than failing the whole overview.
	 */
	public async getInstanceOverview(): Promise<SearchInstanceOverview> {
		const [statsRes, versionRes, healthRes, rawInfoRes, indexStatsRes, facetRes] =
			await Promise.allSettled([
				this.client.getStats(),
				this.client.getVersion(),
				this.client.health(),
				this.getIndex('emails').then((i) => i.getRawInfo()),
				this.getIndex('emails').then((i) => i.getStats()),
				// Per-source document counts straight from the search index (facet
				// distribution on the filterable `ingestionSourceId` attribute).
				this.getIndex<EmailDocument>('emails').then((i) =>
					i.search('', { facets: ['ingestionSourceId'], limit: 0 })
				),
			]);

		const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;
		const version = versionRes.status === 'fulfilled' ? versionRes.value : null;
		const health =
			healthRes.status === 'fulfilled' && healthRes.value.status === 'available'
				? 'available'
				: 'unavailable';

		// Per-source document counts from the search index, enriched with names for
		// display (names come from the DB purely as labels; the COUNTS are Meilisearch's).
		let documentsBySource: SearchInstanceOverview['documentsBySource'] = [];
		if (facetRes.status === 'fulfilled') {
			const dist = facetRes.value.facetDistribution?.ingestionSourceId ?? {};
			const entries = Object.entries(dist).map(([ingestionSourceId, count]) => ({
				ingestionSourceId,
				count: count as number,
			}));
			const names = await IngestionService.getSourceNames(
				entries.map((e) => e.ingestionSourceId)
			).catch(() => ({}) as Record<string, string>);
			documentsBySource = entries
				.map((e) => ({ ...e, name: names[e.ingestionSourceId] ?? null }))
				.sort((a, b) => b.count - a.count);
		}

		let index: SearchIndexInfo | null = null;
		if (rawInfoRes.status === 'fulfilled' && indexStatsRes.status === 'fulfilled') {
			const raw = rawInfoRes.value;
			const iStats = indexStatsRes.value;
			index = {
				uid: raw.uid,
				primaryKey: raw.primaryKey ?? null,
				numberOfDocuments: iStats.numberOfDocuments,
				isIndexing: iStats.isIndexing,
				fieldDistribution: iStats.fieldDistribution,
				rawDocumentDbSize: iStats.rawDocumentDbSize,
				avgDocumentSize: iStats.avgDocumentSize,
				createdAt: raw.createdAt ?? null,
				updatedAt: raw.updatedAt ?? null,
			};
		}

		return {
			host: config.search.host,
			version: version
				? {
						pkgVersion: version.pkgVersion,
						commitSha: version.commitSha,
						commitDate: version.commitDate,
					}
				: null,
			health,
			databaseSize: stats?.databaseSize ?? 0,
			usedDatabaseSize: stats?.usedDatabaseSize ?? 0,
			lastUpdate: stats?.lastUpdate ?? null,
			index,
			documentsBySource,
		};
	}

	/**
	 * Cursor-paginated Meilisearch task list, scoped to the `emails` index.
	 */
	public async getTasks(query: {
		limit: number;
		from?: number;
		statuses?: SearchTaskStatus[];
		types?: SearchTaskType[];
	}): Promise<SearchTasksResult> {
		const result = await this.client.tasks.getTasks({
			limit: query.limit,
			from: query.from,
			indexUids: ['emails'],
			...(query.statuses && query.statuses.length ? { statuses: query.statuses } : {}),
			...(query.types && query.types.length ? { types: query.types as TaskType[] } : {}),
		});

		return {
			results: result.results.map((t) => ({
				uid: t.uid,
				indexUid: t.indexUid,
				status: t.status,
				type: t.type,
				enqueuedAt: t.enqueuedAt,
				startedAt: t.startedAt,
				finishedAt: t.finishedAt,
				duration: t.duration,
				error: t.error
					? {
							message: t.error.message,
							code: t.error.code,
							type: t.error.type,
							link: t.error.link,
						}
					: null,
				details: t.details
					? {
							receivedDocuments: t.details.receivedDocuments,
							indexedDocuments: t.details.indexedDocuments,
							deletedDocuments: t.details.deletedDocuments,
							primaryKey: t.details.primaryKey,
						}
					: undefined,
			})),
			total: result.total,
			limit: result.limit,
			from: result.from,
			next: result.next,
		};
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
			const filterParts: string[] = [];
			for (const [key, value] of Object.entries(filters)) {
				// Expand ingestionSourceId to the full merge group
				if (key === 'ingestionSourceId' && typeof value === 'string') {
					const groupIds = await IngestionService.findGroupSourceIds(value);
					if (groupIds.length === 1) {
						filterParts.push(`ingestionSourceId = '${groupIds[0]}'`);
					} else {
						const inList = groupIds.map((id) => `'${id}'`).join(', ');
						filterParts.push(`ingestionSourceId IN [${inList}]`);
					}
				} else if (typeof value === 'string') {
					filterParts.push(`${key} = '${value}'`);
				} else {
					filterParts.push(`${key} = ${value}`);
				}
			}
			searchParams.filter = filterParts.join(' AND ');
		}

		// Create a filter based on the user's permissions.
		// This ensures that the user can only search for emails they are allowed to see.
		const { searchFilter } = await FilterBuilder.create(userId, 'archive', 'read');
		if (searchFilter) {
			// Convert the MongoDB-style filter from CASL to a MeiliSearch filter string.
			if (searchParams.filter) {
				// If there are existing filters, append the access control filter.
				searchParams.filter = `${searchParams.filter} AND ${searchFilter}`;
			} else {
				// Otherwise, just use the access control filter.
				searchParams.filter = searchFilter;
			}
		}
		// console.log('searchParams', searchParams);
		const searchResults = await index.search(query, searchParams);

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

		// Enrich each address with its display name from Postgres so the widget shows
		// resolved names (e.g. Exchange senders whose address is an X.500 DN) instead of
		// the raw address. The COUNTS remain Meilisearch's; names are labels only, resolved
		// from the DB so this works on already-indexed data with no reindex (#413).
		const addresses = sortedSenders.map((s) => s.sender);
		const nameRows = addresses.length
			? await db
					.selectDistinctOn([archivedEmails.senderEmail], {
						senderEmail: archivedEmails.senderEmail,
						senderName: archivedEmails.senderName,
					})
					.from(archivedEmails)
					.where(
						and(
							inArray(archivedEmails.senderEmail, addresses),
							isNotNull(archivedEmails.senderName)
						)
					)
			: [];
		const nameByAddress = new Map(nameRows.map((r) => [r.senderEmail, r.senderName]));

		return sortedSenders.map((s) => ({
			...s,
			senderName: nameByAddress.get(s.sender) ?? null,
		}));
	}

	public async configureEmailIndex() {
		// Ensure the index exists with the correct primary key. Doing this once at
		// startup (instead of on every addDocuments call) avoids a fire-and-forget
		// update racing with document writes on a fresh index.
		//
		// IMPORTANT: createIndex() enqueues an `indexCreation` task that fails
		// asynchronously with "Index `emails` already exists" when the index is
		// already there — it does NOT throw synchronously, so a try/catch cannot
		// suppress it. That produced a failed Meilisearch task on every boot.
		// Check for existence first and only create when actually missing.
		try {
			await this.client.getIndex('emails');
		} catch (error: any) {
			// meilisearch-js surfaces the API error code under `cause.code`
			// (older versions used `code`); check both for robustness.
			const code = error?.cause?.code ?? error?.code;
			if (code === 'index_not_found') {
				await this.client.createIndex('emails', { primaryKey: 'id' });
			} else {
				logger.warn({ error }, 'Failed to check whether the emails index exists');
			}
		}

		const index = await this.getIndex('emails');
		await index.updateSettings({
			searchableAttributes: [
				'subject',
				'body',
				'from',
				'fromName',
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
