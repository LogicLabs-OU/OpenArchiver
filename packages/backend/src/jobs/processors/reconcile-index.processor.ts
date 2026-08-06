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

	// Backpressure: if the indexing queue is already busy (e.g. a large import is in
	// flight), defer this tick rather than piling on more work.
	const counts = await indexingQueue.getJobCounts('waiting', 'active', 'delayed');
	const pending = (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);
	if (pending >= config.indexing.reconcileBackpressureThreshold) {
		logger.info(
			{ pending, threshold: config.indexing.reconcileBackpressureThreshold },
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
