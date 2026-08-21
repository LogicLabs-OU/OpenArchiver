import { Job } from 'bullmq';
import { and, eq, lt } from 'drizzle-orm';
import { IReconcileIndexJob } from '@open-archiver/types';
import { archivedEmails } from '../../database/schema';
import { indexingQueue } from '../queues';
import { enqueueIndexBacklog } from '../helpers/indexBacklog';
import { config } from '../../config';
import { logger } from '../../config/logger';

/**
 * Self-healing job: finds emails that never made it into the search index
 * (is_indexed = false) and re-queues them for indexing. This closes gaps left by
 * any failure — worker crash, exhausted retries, transient Meilisearch trouble —
 * without user action.
 *
 * Poison emails (index_attempts >= maxIndexAttempts) are skipped so a permanently
 * un-indexable email does not churn the queue forever; it stays a visible gap in
 * the index-health indicator instead.
 */
export default async function reconcileIndexProcessor(_job: Job<IReconcileIndexJob>) {
	if (!config.indexing.reconcileEnabled) {
		logger.debug('Index reconcile disabled, skipping tick');
		return;
	}

	// Backpressure: if the indexing queue has any other work at all, defer this tick.
	//
	// A threshold alone was enough while the worker ran one job at a time, because nothing else
	// could be running during this tick. With several jobs in flight the reconcile scan reads rows
	// those jobs are midway through — is_indexed stays false until Meilisearch confirms — and
	// re-enqueues them, so the same email is built twice and its index_attempts bumped twice,
	// pushing borderline rows past maxIndexAttempts after about half the real failures.
	//
	// This is idle-time self-healing, so waiting for idle costs nothing: the next tick is minutes
	// away and the backlog is not going anywhere. `active` includes this very job, hence > 1.
	//
	// The delayed set needs the same self-exclusion, and cannot get it from a bare count: a BullMQ
	// repeatable job ALWAYS parks its own next iteration there while the current one runs, so a raw
	// delayed count reads the queue as busy on every single tick and this job defers to its own
	// schedule forever — a live deployment deferred every tick and the self-heal never ran once,
	// which is how 372 unindexed emails stayed unindexed with the queue otherwise empty. So list
	// the delayed jobs (a page is plenty: the decision only needs "is any NON-self delayed job
	// present", and beyond our own entry the set holds at most a few backoff retries) and ignore
	// this job's own entries by name, which also covers older repeat-key formats. Genuinely
	// delayed retries still count — a retry owns its rows, and scanning them here would double-bump
	// their index_attempts, which is the exact churn this guard exists to prevent.
	const counts = await indexingQueue.getJobCounts('waiting', 'active');
	const delayedJobs = await indexingQueue.getJobs(['delayed'], 0, 24);
	const delayed = delayedJobs.filter((job) => job && job.name !== 'reconcile-index').length;
	const waiting = (counts.waiting || 0) + delayed;
	const active = counts.active || 0;
	const pending = waiting + active;
	if (active > 1 || waiting > 0 || pending >= config.indexing.reconcileBackpressureThreshold) {
		logger.info(
			{ waiting, active, threshold: config.indexing.reconcileBackpressureThreshold },
			'Index reconcile deferred: indexing queue busy'
		);
		return;
	}

	// The `index_attempts < maxIndexAttempts` bound is what guarantees forward progress:
	// the scan always restarts from the front, so a permanently-failing ("poison") email at
	// the head would otherwise be re-enqueued every tick and starve the tail. IndexingService
	// isolates such poison per-document and bumps its index_attempts until it crosses this
	// bound and drops out of the scan, letting the keyset cursor advance past it.
	const enqueued = await enqueueIndexBacklog({
		where: and(
			eq(archivedEmails.isIndexed, false),
			lt(archivedEmails.indexAttempts, config.indexing.maxIndexAttempts)
		),
		pageCap: config.indexing.reconcilePageCap,
	});

	if (enqueued > 0) {
		logger.info({ enqueued }, 'Index reconcile enqueued missing emails for indexing');
	} else {
		logger.debug('Index reconcile found no missing emails');
	}
}
