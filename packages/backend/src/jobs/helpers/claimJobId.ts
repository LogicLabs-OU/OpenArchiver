import type { Queue } from 'bullmq';

/**
 * Frees a fixed job id if the work under it has finished, and reports whether it is still live.
 *
 * A fixed `jobId` is how a maintenance sweep is kept to one instance at a time. On its own that is
 * not enough: BullMQ treats *any* surviving record under the id as a duplicate and silently drops
 * the new job, and finished records do survive — they are retained by the worker's
 * `removeOnComplete` / `removeOnFail` counts. Left alone, the endpoint would keep answering
 * "queued" after the first run while queueing nothing, until a hundred later jobs displaced the
 * record. Clearing a terminal record keeps the action repeatable while the id still does its real
 * job.
 *
 * Removal is allowed to fail: it throws for a job that turned active in between, and the `add` that
 * follows is then absorbed by that live job — the same outcome as reporting it already running.
 *
 * @returns true when a run is still queued or in progress, so the caller should not add another.
 */
export const claimJobId = async (queue: Queue, jobId: string): Promise<boolean> => {
	const existing = await queue.getJob(jobId);
	if (!existing) {
		return false;
	}

	const state = await existing.getState();
	if (state === 'completed' || state === 'failed' || state === 'unknown') {
		await existing.remove().catch(() => undefined);
		return false;
	}

	return true;
};

/**
 * Whether a job under this id is still queued or running.
 *
 * A read-only probe, deliberately separate from {@link claimJobId}: that one *removes* a terminal
 * record as a side effect, which is right when claiming an id and wrong when merely asking after
 * one. A caller that wants to know whether work is in flight must not quietly delete its record.
 */
export const isJobLive = async (queue: Queue, jobId: string): Promise<boolean> => {
	const existing = await queue.getJob(jobId);
	if (!existing) {
		return false;
	}

	const state = await existing.getState();
	return state !== 'completed' && state !== 'failed' && state !== 'unknown';
};
