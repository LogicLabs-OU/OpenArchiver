/**
 * Represents the possible statuses of a job in the queue.
 */
export type JobStatus = 'active' | 'completed' | 'failed' | 'delayed' | 'waiting' | 'paused';

/**
 * Scope of a reindex job.
 * - `source`: reindex a single ingestion source (and its merge group).
 * - `all`: reindex the entire archive.
 */
export type ReindexScope = 'source' | 'all';

/**
 * Mode of a reindex job.
 * - `missing`: only (re)index emails that are not yet marked indexed (cheap, self-healing).
 * - `full`: reset the scoped rows to unindexed and rebuild every document.
 */
export type ReindexMode = 'missing' | 'full';

/**
 * Payload for the `reindex` master job on the indexing queue. It rebuilds
 * Meilisearch documents from the source-of-truth `archived_emails` rows without
 * re-ingesting. Idempotent — Meilisearch is keyed by the email id, so re-adding
 * a document upserts rather than duplicates.
 */
export interface IReindexJob {
	scope: ReindexScope;
	/** Required when scope is `source`. */
	ingestionSourceId?: string;
	mode: ReindexMode;
}

/** Payload for the periodic `reconcile-index` self-healing job (no fields needed). */
export interface IReconcileIndexJob {}

/**
 * A detailed representation of a job, providing essential information for monitoring and debugging.
 */
export interface IJob {
	id: string | undefined;
	name: string;
	data: any;
	state: string;
	failedReason: string | undefined;
	timestamp: number;
	processedOn: number | undefined;
	finishedOn: number | undefined;
	attemptsMade: number;
	stacktrace: string[];
	returnValue: any;
	ingestionSourceId?: string;
	error?: any;
}

/**
 * Holds the count of jobs in various states for a single queue.
 */
export interface IQueueCounts {
	active: number;
	completed: number;
	failed: number;
	delayed: number;
	waiting: number;
	paused: number;
}

/**
 * Provides a high-level overview of a queue, including its name and job counts.
 */
export interface IQueueOverview {
	name: string;
	counts: IQueueCounts;
}

/**
 * Represents the pagination details for a list of jobs.
 */
export interface IPagination {
	currentPage: number;
	totalPages: number;
	totalJobs: number;
	limit: number;
}

/**
 * Provides a detailed view of a specific queue, including a paginated list of its jobs.
 */
export interface IQueueDetails {
	name: string;
	counts: IQueueCounts;
	jobs: IJob[];
	pagination: IPagination;
}

// --- API Request & Response Types ---

/**
 * Response body for the endpoint that lists all queues.
 */
export interface IGetQueuesResponse {
	queues: IQueueOverview[];
}

/**
 * URL parameters for the endpoint that retrieves jobs from a specific queue.
 */
export interface IGetQueueJobsRequestParams {
	queueName: string;
}

/**
 * Query parameters for filtering and paginating jobs within a queue.
 */
export interface IGetQueueJobsRequestQuery {
	status: JobStatus;
	page: string; // Received as a string from query params
	limit: string; // Received as a string from query params
}

/**
 * Response body for the endpoint that retrieves jobs from a specific queue.
 */
export type IGetQueueJobsResponse = IQueueDetails;
