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
 * What a reindex request actually achieved, beyond "the job reached the queue".
 *
 * Enqueuing succeeds whether or not anything will ever consume the queue, so a bare 202 told users
 * their reindex had started when in fact nothing was listening. These two fields are what let the
 * UI say something true.
 */
export interface IReindexDispatch {
	/** How many emails the dispatched job will hand to the indexer. Zero means there was nothing to do. */
	pending: number;
	/** Whether an indexing worker has reported a heartbeat recently enough to be doing the work. */
	workerAlive: boolean;
}

/** Body returned by both reindex endpoints. */
export interface IReindexResponse extends IReindexDispatch {
	message: string;
}

/**
 * Payload for the `cleanup-orphans` job on the indexing queue (no fields needed).
 *
 * Removes documents the search index still holds for emails the database no longer has. Those are
 * left behind when a delete removes the row but its Meilisearch counterpart never follows — the
 * search result then resolves to nothing and the user is told the email cannot be found.
 */
export interface ICleanupOrphansJob {}

/**
 * What a cleanup request could establish before the sweep itself runs.
 *
 * The exact orphan count is only knowable by scanning the whole index, which is the job's work, so
 * the endpoint reports what it can cheaply see instead of pretending to a precise figure.
 */
export interface ICleanupOrphansDispatch {
	/**
	 * Documents in the index minus rows in the database. A rough guide, not a target: emails
	 * archived but not yet indexed count the other way and mask orphans one for one, so the true
	 * number can be higher. Never negative.
	 */
	estimatedOrphans: number;
	/** Whether an indexing worker has reported a heartbeat recently enough to be doing the work. */
	workerAlive: boolean;
	/**
	 * True when a sweep was already queued or running, so this request joined it rather than
	 * starting another. Only one runs at a time — two would page through the same shifting offsets.
	 */
	alreadyRunning: boolean;
}

/** Body returned by the orphan-cleanup endpoint. */
export interface ICleanupOrphansResponse extends ICleanupOrphansDispatch {
	message: string;
}

/** What a completed orphan sweep removed. Logged by the job and returned as its result. */
export interface ICleanupOrphansResult {
	/** Documents removed in whole-source blocks, for sources no longer in the database. */
	sourceBlocksRemoved: number;
	/** Individually removed documents whose email row is gone. */
	documentsRemoved: number;
	/** Documents examined during the per-document sweep. */
	scanned: number;
}

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
