import type { JobsOptions } from 'bullmq';
import { dateBackfillQueue } from '../jobs/queues';
import {
	runCounterKey,
	type DateBackfillPlanJobData,
} from '../jobs/processors/date-backfill.processor';

export interface BackfillOptions {
	ingestionSourceId?: string;
	batchSize?: number;
}

export interface BackfillStatus {
	state: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
	jobId: string;
	total: number;
	scanned: number;
	updated: number;
	failed: number;
	startedAt: string | null;
	finishedAt: string | null;
}

/**
 * Façade over `dateBackfillQueue` for admin REST endpoints and CLI.
 *
 * Static methods only — there is no per-instance state. The queue and its
 * Redis connection are process-level singletons.
 *
 * `pause()` / `resume()` are *queue-level* — they affect every running
 * date-backfill job, not a specific planner. This is the only granularity
 * BullMQ exposes out of the box.
 */
export class DateBackfillService {
	/**
	 * Enqueues a planner job. The planner fan-outs batch jobs onto the same
	 * queue. Returns the planner job id, which is the handle for `status()`.
	 */
	public static async start(opts: BackfillOptions): Promise<{ jobId: string }> {
		const data: DateBackfillPlanJobData = {
			ingestionSourceId: opts.ingestionSourceId,
			batchSize: opts.batchSize,
		};
		const jobOptions: JobsOptions = {
			// Planner is idempotent (resume via date_backfilled_at IS NULL), but
			// per-row work is expensive. Disable retries on the planner — if it
			// dies, re-run the start endpoint.
			attempts: 1,
			removeOnComplete: { count: 50 },
			removeOnFail: { count: 50 },
		};
		const job = await dateBackfillQueue.add('date-backfill:plan', data, jobOptions);
		if (!job.id) {
			throw new Error('Failed to enqueue date-backfill planner: no job id returned');
		}
		return { jobId: job.id };
	}

	/**
	 * Pauses the entire date-backfill queue. All running planner / batch
	 * workers stop accepting new jobs once their current job completes.
	 *
	 * Note: this is queue-level, not job-level. There is no per-job pause in
	 * BullMQ — you can only pause the worker as a whole.
	 */
	public static async pause(): Promise<void> {
		await dateBackfillQueue.pause();
	}

	/**
	 * Resumes the entire date-backfill queue. Mirrors `pause()`.
	 */
	public static async resume(): Promise<void> {
		await dateBackfillQueue.resume();
	}

	/**
	 * Returns a snapshot of the planner job's state plus the live counters
	 * (which include progress from all batch jobs it has spawned).
	 *
	 * Counters live in a Redis hash keyed by the planner job id. They survive
	 * the planner reaching `completed` state, so callers can still poll for
	 * progress while the spawned batches are still finishing.
	 */
	public static async status(jobId: string): Promise<BackfillStatus> {
		const job = await dateBackfillQueue.getJob(jobId);
		if (!job) {
			throw new Error(`Date-backfill job ${jobId} not found`);
		}

		const bullState = await job.getState().catch(() => 'unknown');
		const redis = await dateBackfillQueue.client;
		const counters = (await redis.hgetall(runCounterKey(jobId))) as Record<string, string>;

		const total = Number(counters.total ?? 0);
		const scanned = Number(counters.scanned ?? 0);
		const updated = Number(counters.updated ?? 0);
		const failed = Number(counters.failed ?? 0);

		const state = mapBullState(bullState, { total, scanned });
		const startedAt = job.processedOn ? new Date(job.processedOn).toISOString() : null;
		const finishedAt = job.finishedOn ? new Date(job.finishedOn).toISOString() : null;

		return {
			state,
			jobId,
			total,
			scanned,
			updated,
			failed,
			startedAt,
			finishedAt,
		};
	}
}

/**
 * Collapse BullMQ's 9-state alphabet into the 5-state contract our admin
 * surface promises. We separate "planner is enqueueing" (`running`) from
 * "planner done, batches still in flight" (still `running` until counters
 * reach `total`).
 */
function mapBullState(
	bullState: string,
	counters: { total: number; scanned: number }
): BackfillStatus['state'] {
	switch (bullState) {
		case 'completed':
			// Planner finished enqueueing — but batches may still be running.
			// Report `running` until the scanned counter catches up to total.
			if (counters.total > 0 && counters.scanned < counters.total) {
				return 'running';
			}
			return 'completed';
		case 'failed':
			return 'failed';
		case 'paused':
			return 'paused';
		case 'active':
		case 'waiting-children':
			return 'running';
		case 'waiting':
		case 'delayed':
		case 'prioritized':
			return 'pending';
		default:
			return 'pending';
	}
}
