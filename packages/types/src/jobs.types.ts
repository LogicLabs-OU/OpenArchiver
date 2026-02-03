/**
 * Represents the possible statuses of a job in the queue.
 */
export type JobStatus = 'active' | 'completed' | 'failed' | 'delayed' | 'waiting' | 'paused';

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
