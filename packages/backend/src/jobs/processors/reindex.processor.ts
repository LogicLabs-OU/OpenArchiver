import { Job } from 'bullmq';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { IReindexJob } from '@open-archiver/types';
import { archivedEmails } from '../../database/schema';
import { IngestionService } from '../../services/IngestionService';
import { enqueueIndexBacklog } from '../helpers/indexBacklog';
import { resetIndexedFlagChunked } from '../helpers/resetIndexedFlag';
import { logger } from '../../config/logger';

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
		scopeFilter =
			groupIds.length === 1
				? eq(archivedEmails.ingestionSourceId, groupIds[0])
				: inArray(archivedEmails.ingestionSourceId, groupIds);
	}

	logger.info({ scope, ingestionSourceId, mode }, 'Starting reindex job');

	// Both resets are chunked (keyset batches) rather than one table-wide UPDATE so a
	// full-archive reindex does not take a giant, long-held lock at millions-of-rows scale.
	if (mode === 'full') {
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

	// Both modes now enqueue the scoped, unindexed rows. No pageCap — a user-triggered
	// reindex should drain the full backlog (each job holds up to indexingBatchSize ids,
	// so even millions of emails is only a few thousand small jobs).
	const where: SQL = scopeFilter
		? and(scopeFilter, eq(archivedEmails.isIndexed, false))!
		: eq(archivedEmails.isIndexed, false);

	const enqueued = await enqueueIndexBacklog({ where });

	logger.info({ scope, ingestionSourceId, mode, enqueued }, 'Reindex job finished dispatching');
}
