import type { JobsOptions } from 'bullmq';
import { reindexQueue } from '../jobs/queues';
import type {
	ReindexJobData,
	ReindexProgress,
	ReindexScope,
} from '../jobs/processors/reindex-emails.processor';

export type { ReindexScope, ReindexJobData, ReindexProgress };

export interface ReindexOptions {
	scope: ReindexScope;
	ingestionSourceId?: string;
	dateFrom?: string;
	dateTo?: string;
	batchSize?: number;
}

export interface ReindexStatus {
	jobId: string;
	state:
		| 'completed'
		| 'failed'
		| 'delayed'
		| 'active'
		| 'waiting'
		| 'waiting-children'
		| 'prioritized'
		| 'paused'
		| 'unknown';
	progress: ReindexProgress | number | null;
	failedReason?: string;
	returnvalue?: ReindexProgress | null;
	createdAt?: number;
	processedOn?: number;
	finishedOn?: number;
	data: ReindexJobData;
}

/**
 * Façade over `reindexQueue` for the admin REST endpoints.
 *
 * Static methods only — there is no per-instance state. The queue is a process-
 * level singleton (one Redis connection from `config/redis`).
 */
export class ReindexService {
	public static async start(opts: ReindexOptions): Promise<{ jobId: string }> {
		const data: ReindexJobData = {
			scope: opts.scope,
			ingestionSourceId: opts.ingestionSourceId,
			dateFrom: opts.dateFrom,
			dateTo: opts.dateTo,
			batchSize: opts.batchSize,
		};
		const jobOptions: JobsOptions = {
			// The orchestrator is idempotent at the index-write layer (Meili
			// upsert by id), so retries are safe. One retry is plenty.
			attempts: 1,
			removeOnComplete: { count: 50 },
			removeOnFail: { count: 50 },
		};
		const job = await reindexQueue.add('reindex-emails', data, jobOptions);
		if (!job.id) {
			throw new Error('Failed to enqueue reindex job: no job id returned');
		}
		return { jobId: job.id };
	}

	public static async status(jobId: string): Promise<ReindexStatus> {
		const job = await reindexQueue.getJob(jobId);
		if (!job) {
			throw new Error(`Reindex job ${jobId} not found`);
		}
		const state = await job.getState().catch(() => 'unknown');
		const progress = (job.progress as ReindexProgress | number | null) ?? null;
		return {
			jobId,
			state: state as ReindexStatus['state'],
			progress,
			failedReason: job.failedReason ?? undefined,
			returnvalue: (job.returnvalue as ReindexProgress | null) ?? null,
			createdAt: job.timestamp,
			processedOn: job.processedOn ?? undefined,
			finishedOn: job.finishedOn ?? undefined,
			data: job.data as ReindexJobData,
		};
	}

	/**
	 * Best-effort cancel: marks completed/failed jobs no-op, removes queued
	 * jobs, and signals running jobs via BullMQ's `moveToFailed` path. Already-
	 * dispatched `index-email-batch` jobs continue to run — cancelling the
	 * orchestrator only stops further batches being enqueued.
	 */
	public static async cancel(jobId: string): Promise<void> {
		const job = await reindexQueue.getJob(jobId);
		if (!job) {
			throw new Error(`Reindex job ${jobId} not found`);
		}
		const state = await job.getState().catch(() => 'unknown');
		if (state === 'completed' || state === 'failed') {
			return;
		}
		if (state === 'active') {
			// `discard` prevents requeue if the worker later calls moveToFailed.
			await job.discard().catch(() => undefined);
			return;
		}
		// waiting / delayed / paused / prioritized — safe to remove.
		await job.remove();
	}
}
