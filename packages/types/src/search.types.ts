import type { EmailDocument } from './email.types';

export type MatchingStrategy = 'last' | 'all' | 'frequency';

export interface SearchQuery {
	query: string;
	filters?: Record<string, any>;
	page?: number;
	limit?: number;
	matchingStrategy?: MatchingStrategy;
}

export interface SearchHit extends EmailDocument {
	_matchesPosition?: {
		[key: string]: { start: number; length: number; indices?: number[] }[];
	};
	_formatted?: Partial<EmailDocument>;
}

export interface SearchResult {
	hits: SearchHit[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
	processingTimeMs: number;
}

// --- Search engine (Meilisearch) admin observability ---

/** Meilisearch task lifecycle status. */
export type SearchTaskStatus = 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled';

/** Common Meilisearch task types (open-ended — the engine may report others). */
export type SearchTaskType =
	| 'documentAdditionOrUpdate'
	| 'documentDeletion'
	| 'settingsUpdate'
	| 'indexCreation'
	| 'indexUpdate'
	| 'indexDeletion'
	| 'indexSwap'
	| 'taskCancelation'
	| 'taskDeletion'
	| 'dumpCreation'
	| 'snapshotCreation'
	| (string & {});

/** Stats/metadata for a single search index. */
export interface SearchIndexInfo {
	uid: string;
	primaryKey: string | null;
	numberOfDocuments: number;
	isIndexing: boolean;
	fieldDistribution: Record<string, number>;
	rawDocumentDbSize: number;
	avgDocumentSize: number;
	createdAt: string | null;
	updatedAt: string | null;
}

/** Document count per ingestion source, as reported by the search index itself
 *  (Meilisearch facet distribution) — NOT the database. `name` is a display label
 *  looked up separately; `null` for sources no longer in the database. */
export interface SearchDocumentsBySource {
	ingestionSourceId: string;
	name: string | null;
	count: number;
}

/** Instance-level overview of the search engine, for the admin index page. */
export interface SearchInstanceOverview {
	host: string;
	version: { pkgVersion: string; commitSha: string; commitDate: string } | null;
	health: 'available' | 'unavailable';
	databaseSize: number;
	usedDatabaseSize: number;
	lastUpdate: string | null;
	/** Info for the `emails` index (null if it does not exist yet). */
	index: SearchIndexInfo | null;
	/** Per-ingestion-source document counts from the search index (Meilisearch facets). */
	documentsBySource: SearchDocumentsBySource[];
}

/** A Meilisearch task, trimmed to the fields the admin page needs. */
export interface SearchTask {
	uid: number;
	indexUid: string | null;
	status: SearchTaskStatus;
	type: SearchTaskType;
	enqueuedAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	duration: string | null;
	error: { message?: string; code?: string; type?: string; link?: string } | null;
	details?: {
		receivedDocuments?: number;
		indexedDocuments?: number;
		deletedDocuments?: number;
		primaryKey?: string;
	};
}

/** Cursor-paginated task list. `next` is the cursor for the following page (null = last page). */
export interface SearchTasksResult {
	results: SearchTask[];
	total: number;
	limit: number;
	from: number | null;
	next: number | null;
}
