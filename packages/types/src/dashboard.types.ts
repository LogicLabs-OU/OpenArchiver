export interface DashboardStats {
	totalEmailsArchived: number;
	totalStorageUsed: number;
	failedIngestionsLast7Days: number;
}

export interface IngestionHistory {
	history: {
		date: string;
		count: number;
	}[];
}

export interface IngestionSourceStats {
	id: string;
	name: string;
	provider: string;
	status: string;
	storageUsed: number;
}

export interface RecentSync {
	id: string;
	sourceName: string;
	startTime: string;
	duration: number;
	emailsProcessed: number;
	status: string;
}

export interface TopSender {
	sender: string;
	count: number;
}

export interface IndexedInsights {
	topSenders: TopSender[];
}

/**
 * Index-health snapshot comparing how many emails are archived in the database
 * against how many documents exist in the search index. A gap indicates emails
 * that are missing from search and can be repaired with a reindex.
 */
export interface IndexHealth {
	/** Number of archived emails in the database (source of truth). */
	archivedCount: number;
	/** Number of documents present in the Meilisearch index. */
	indexedCount: number;
}
