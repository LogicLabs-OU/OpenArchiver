import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import { db } from '../../database';
import { archivedEmails } from '../../database/schema';
import { indexingQueue } from '../queues';
import { config } from '../../config';
import type { PendingEmail, ReindexMode } from '@open-archiver/types';

/**
 * The set of rows a reindex will hand to the indexer.
 *
 * `full` rebuilds everything in scope; `missing` only what the database believes is absent. Shared so
 * the count reported on the API response and the scan the processor actually runs cannot drift apart
 * — they were identical only by inspection, and a user-facing "0 emails queued" that disagreed with
 * the job would be worse than no number at all.
 *
 * Note the asymmetry: the processor resets `is_indexed` to false across the scope BEFORE running this
 * for `full`, so both modes end up scanning for unindexed rows. The count runs before that reset,
 * which is why it needs the mode to know what to expect.
 */
export const buildReindexWhere = (mode: ReindexMode, scopeFilter?: SQL): SQL | undefined => {
	const conditions: SQL[] = [];
	if (scopeFilter) {
		conditions.push(scopeFilter);
	}
	if (mode !== 'full') {
		conditions.push(eq(archivedEmails.isIndexed, false));
	}
	return conditions.length ? and(...conditions) : undefined;
};

interface EnqueueBacklogOptions {
	/** Extra filter combined (AND) with the keyset cursor, e.g. is_indexed = false
	 *  or an ingestion-source scope. */
	where?: SQL;
	/** Max number of index-email-batch jobs to enqueue before stopping. Used by the
	 *  reconcile job to drain a huge backlog over several ticks. Undefined = drain fully. */
	pageCap?: number;
}

/**
 * Keyset-paginates `archived_emails` (ordered by id) matching `where` and enqueues
 * each page as an `index-email-batch` job. Payloads carry only ids, matching the
 * existing tiny-payload design. Keyset (id > cursor) is used instead of OFFSET so
 * deep pages stay O(log n) at millions-of-rows scale.
 *
 * @returns the number of emails enqueued.
 */
export async function enqueueIndexBacklog(options: EnqueueBacklogOptions = {}): Promise<number> {
	const { where, pageCap } = options;
	const pageSize = config.meili.indexingBatchSize;

	let cursor: string | null = null;
	let pages = 0;
	let totalEnqueued = 0;

	while (pageCap === undefined || pages < pageCap) {
		const conditions: SQL[] = [];
		if (where) {
			conditions.push(where);
		}
		if (cursor) {
			conditions.push(gt(archivedEmails.id, cursor));
		}

		const rows = await db
			.select({ id: archivedEmails.id })
			.from(archivedEmails)
			.where(conditions.length ? and(...conditions) : undefined)
			.orderBy(asc(archivedEmails.id))
			.limit(pageSize);

		if (rows.length === 0) {
			break;
		}

		const emails: PendingEmail[] = rows.map((r) => ({ archivedEmailId: r.id }));
		await indexingQueue.add('index-email-batch', { emails });

		totalEnqueued += rows.length;
		pages++;
		cursor = rows[rows.length - 1].id;

		if (rows.length < pageSize) {
			break;
		}
	}

	return totalEnqueued;
}
