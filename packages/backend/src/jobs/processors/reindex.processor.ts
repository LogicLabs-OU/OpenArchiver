import { Job } from 'bullmq';
import { and, eq, type SQL } from 'drizzle-orm';
import { IReindexJob } from '@open-archiver/types';
import { archivedEmails } from '../../database/schema';
import { IngestionService } from '../../services/IngestionService';
import { buildReindexWhere, enqueueIndexBacklog } from '../helpers/indexBacklog';
import { indexingQueue } from '../queues';
import { resetIndexedFlagChunked } from '../helpers/resetIndexedFlag';
import { logger } from '../../config/logger';

/** How long a full rebuild waits for other indexing jobs to finish before proceeding regardless. */
const IDLE_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_POLL_INTERVAL_MS = 5_000;

/**
 * Blocks until this job is the only active one on the indexing queue, or the timeout expires.
 * `active` counts this job itself, so idle means <= 1.
 */
const waitForIndexingIdle = async (): Promise<void> => {
	const deadline = Date.now() + IDLE_WAIT_TIMEOUT_MS;
	for (;;) {
		const { active = 0 } = await indexingQueue.getJobCounts('active');
		if (active <= 1) {
			return;
		}
		if (Date.now() >= deadline) {
			logger.warn(
				{ active, waitedMs: IDLE_WAIT_TIMEOUT_MS },
				'Proceeding with full reindex while other indexing jobs are still active; rows they mark indexed after the reset may need a reconcile pass'
			);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_INTERVAL_MS));
	}
};

/**
 * Reindex master job. Rebuilds Meilisearch documents from the source-of-truth
 * `archived_emails` rows without re-ingesting — no new DB rows, no storage writes.
 * Idempotent: Meilisearch is keyed by the email id, so re-adding a document upserts
 * rather than duplicates.
 *
 * Modes:
 * - `full`: reset the scoped rows to unindexed (index_attempts cleared) and rebuild
 *    every document.
 * - `missing`: clear the poison-pill counter on unindexed scoped rows and (re)index
 *    only those still missing from the index.
 *
 * In both modes the scoped rows end up `is_indexed = false`, so the same keyset scan
 * over `is_indexed = false` drives the enqueue. Reuses the exact `index-email-batch`
 * worker path, so all task-verification / mark-indexed reliability applies.
 */
export default async function reindexProcessor(job: Job<IReindexJob>) {
	const { scope, ingestionSourceId, mode } = job.data;

	// Build the source scope filter.
	let scopeFilter: SQL | undefined;
	if (scope === 'source') {
		if (!ingestionSourceId) {
			throw new Error('reindex job with scope "source" requires an ingestionSourceId');
		}
		// Include the whole merge group so children reindex with their root.
		const groupIds = await IngestionService.findGroupSourceIds(ingestionSourceId);
		scopeFilter = IngestionService.groupScopeFilter(groupIds);
	}

	logger.info({ scope, ingestionSourceId, mode }, 'Starting reindex job');

	// Both resets are chunked (keyset batches) rather than one table-wide UPDATE so a
	// full-archive reindex does not take a giant, long-held lock at millions-of-rows scale.
	if (mode === 'full') {
		// Wait for the other indexing jobs to drain before clearing the flags. A job already in
		// flight marks its emails indexed when Meilisearch confirms them, and if that lands after
		// the reset, those rows read as indexed to the enqueue scan below and are silently left out
		// of the rebuild the user asked for. Bounded, and proceeds anyway rather than abandoning a
		// user-triggered job: the reconcile pass covers whatever slips through.
		await waitForIndexingIdle();

		// Reset the scoped rows so every one is rebuilt.
		await resetIndexedFlagChunked({
			where: scopeFilter,
			set: { isIndexed: false, indexAttempts: 0 },
		});
	} else {
		// Missing mode: clear the poison-pill counter on the scoped, still-unindexed
		// rows so an explicit user reindex retries even previously-failing emails.
		await resetIndexedFlagChunked({
			where: scopeFilter
				? and(scopeFilter, eq(archivedEmails.isIndexed, false))
				: eq(archivedEmails.isIndexed, false),
			set: { indexAttempts: 0 },
		});
	}

	// Both modes now enqueue the scoped, unindexed rows — `full` reset them above, so 'missing' is
	// the right predicate for both at this point. No pageCap: a user-triggered reindex should drain
	// the full backlog (each job holds up to indexingBatchSize ids, so even millions of emails is
	// only a few thousand small jobs).
	const enqueued = await enqueueIndexBacklog({
		where: buildReindexWhere('missing', scopeFilter),
	});

	logger.info({ scope, ingestionSourceId, mode, enqueued }, 'Reindex job finished dispatching');
}
