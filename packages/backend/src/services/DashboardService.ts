import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { IndexedInsights, IndexHealth } from '@open-archiver/types';

import { archivedEmails, ingestionSources } from '../database/schema';
import { DatabaseService } from './DatabaseService';
import { SearchService } from './SearchService';

class DashboardService {
	#db;
	#searchService;

	constructor(databaseService: DatabaseService, searchService: SearchService) {
		this.#db = databaseService.db;
		this.#searchService = searchService;
	}

	public async getStats() {
		const totalEmailsArchived = await this.#db.select({ count: count() }).from(archivedEmails);
		const totalStorageUsed = await this.#db
			.select({ sum: sql<number>`sum(${archivedEmails.sizeBytes})` })
			.from(archivedEmails);

		const sevenDaysAgo = new Date();
		sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

		const failedIngestionsLast7Days = await this.#db
			.select({ count: count() })
			.from(ingestionSources)
			.where(
				and(
					eq(ingestionSources.status, 'error'),
					gte(ingestionSources.updatedAt, sevenDaysAgo)
				)
			);

		return {
			totalEmailsArchived: totalEmailsArchived[0].count,
			totalStorageUsed: totalStorageUsed[0].sum || 0,
			failedIngestionsLast7Days: failedIngestionsLast7Days[0].count,
		};
	}

	/**
	 * Global index-health: total archived emails in the database vs. total documents
	 * in the search index. A gap means emails are missing from search.
	 */
	public async getIndexHealth(): Promise<IndexHealth> {
		const archived = await this.#db.select({ count: count() }).from(archivedEmails);
		const indexedCount = await this.#searchService.getIndexedCount('emails');
		return {
			archivedCount: archived[0].count,
			indexedCount,
		};
	}

	public async getIngestionHistory() {
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		const history = await this.#db
			.select({
				date: sql<string>`date_trunc('day', ${archivedEmails.archivedAt})`,
				count: count(),
			})
			.from(archivedEmails)
			.where(gte(archivedEmails.archivedAt, thirtyDaysAgo))
			.groupBy(sql`date_trunc('day', ${archivedEmails.archivedAt})`)
			.orderBy(sql`date_trunc('day', ${archivedEmails.archivedAt})`);

		return { history };
	}

	public async getIngestionSources() {
		const sources = await this.#db
			.select({
				id: ingestionSources.id,
				name: ingestionSources.name,
				provider: ingestionSources.provider,
				status: ingestionSources.status,
				storageUsed: sql<number>`sum(${archivedEmails.sizeBytes})`.mapWith(Number),
			})
			.from(ingestionSources)
			.leftJoin(archivedEmails, eq(ingestionSources.id, archivedEmails.ingestionSourceId))
			.groupBy(ingestionSources.id);

		return sources;
	}

	public async getRecentSyncs() {
		// This is a placeholder as we don't have a sync job table yet.
		return Promise.resolve([]);
	}

	public async getIndexedInsights(): Promise<IndexedInsights> {
		const topSenders = await this.#searchService.getTopSenders(10);
		return {
			topSenders,
		};
	}
}

export const dashboardService = new DashboardService(new DatabaseService(), new SearchService());
