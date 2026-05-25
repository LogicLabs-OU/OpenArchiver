import { Job } from 'bullmq';
import { and, asc, eq, gt, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import { indexingQueue } from '../queues';
import { DatabaseService } from '../../services/DatabaseService';
import { archivedEmails } from '../../database/schema';
import { logger } from '../../config/logger';

export type ReindexScope = 'full' | 'date' | 'new-fields-only';

/**
 * Job payload accepted by the reindex orchestrator.
 *
 * - `scope: 'full'` — every row in `archived_emails`.
 * - `scope: 'date'` — rows whose `archivedAt` falls in `[dateFrom, dateTo]`.
 * - `scope: 'new-fields-only'` — rows whose linked Meili document predates the
 *   P3 field set. We approximate this as rows where `archivedAt < dateTo` (a
 *   cutover timestamp the operator passes in). Future schema additions can
 *   reuse the same scope name with a different cutover.
 *
 * `ingestionSourceId` further narrows any scope; useful for re-running one
 * source after a connector fix.
 */
export interface ReindexJobData {
	scope: ReindexScope;
	ingestionSourceId?: string;
	/** ISO 8601 string. Inclusive lower bound on `archived_emails.archived_at`. */
	dateFrom?: string;
	/** ISO 8601 string. Inclusive upper bound on `archived_emails.archived_at`. */
	dateTo?: string;
	/** Number of rows enqueued per `index-email-batch` job. */
	batchSize?: number;
}

export interface ReindexProgress {
	scope: ReindexScope;
	rowsEnqueued: number;
	batchesEnqueued: number;
	lastCursor: { archivedAt: string | null; id: string | null };
	finished: boolean;
}

const DEFAULT_BATCH_SIZE = 500;
const PAGE_SIZE = 500;
const databaseService = new DatabaseService();

/**
 * Build the Drizzle predicate for a given scope.
 *
 * Note: `archivedAt` is `withTimezone: true`, but the column comparison still
 * works with JS Date objects in Drizzle.
 */
function whereForScope(data: ReindexJobData): SQL<unknown> | undefined {
	const conditions: SQL<unknown>[] = [];

	if (data.ingestionSourceId) {
		conditions.push(eq(archivedEmails.ingestionSourceId, data.ingestionSourceId));
	}

	if (data.scope === 'date' || data.scope === 'new-fields-only') {
		if (data.dateFrom) {
			conditions.push(gte(archivedEmails.archivedAt, new Date(data.dateFrom)));
		}
		if (data.dateTo) {
			conditions.push(lte(archivedEmails.archivedAt, new Date(data.dateTo)));
		}
	}

	if (conditions.length === 0) return undefined;
	if (conditions.length === 1) return conditions[0];
	return and(...conditions);
}

/**
 * Cursor-paginate `archived_emails` using `(archived_at, id)` as the stable
 * order key. Drizzle's `or(gt(a, A), and(eq(a, A), gt(b, B)))` pattern keeps
 * page boundaries deterministic even when many rows share the same timestamp.
 */
async function fetchNextPage(
	scopeWhere: SQL<unknown> | undefined,
	cursor: { archivedAt: Date | null; id: string | null }
): Promise<Array<{ id: string; archivedAt: Date }>> {
	const cursorWhere: SQL<unknown> | undefined =
		cursor.archivedAt && cursor.id
			? or(
					gt(archivedEmails.archivedAt, cursor.archivedAt),
					and(
						eq(archivedEmails.archivedAt, cursor.archivedAt),
						gt(archivedEmails.id, cursor.id)
					)
			  )
			: undefined;

	const combined: SQL<unknown> | undefined =
		scopeWhere && cursorWhere
			? and(scopeWhere, cursorWhere)
			: scopeWhere ?? cursorWhere;

	const rows = await databaseService.db
		.select({
			id: archivedEmails.id,
			archivedAt: archivedEmails.archivedAt,
		})
		.from(archivedEmails)
		.where(combined ?? sql`true`)
		.orderBy(asc(archivedEmails.archivedAt), asc(archivedEmails.id))
		.limit(PAGE_SIZE);

	return rows;
}

export default async function reindexEmailsProcessor(
	job: Job<ReindexJobData, ReindexProgress>
): Promise<ReindexProgress> {
	const { scope } = job.data;
	const batchSize = job.data.batchSize ?? DEFAULT_BATCH_SIZE;
	const scopeWhere = whereForScope(job.data);

	logger.info(
		{ jobId: job.id, scope, ingestionSourceId: job.data.ingestionSourceId, batchSize },
		'Reindex orchestrator started'
	);

	let cursor: { archivedAt: Date | null; id: string | null } = {
		archivedAt: null,
		id: null,
	};
	let rowsEnqueued = 0;
	let batchesEnqueued = 0;
	let pendingBatch: { archivedEmailId: string }[] = [];

	const flushBatch = async (): Promise<void> => {
		if (pendingBatch.length === 0) return;
		await indexingQueue.add('index-email-batch', { emails: pendingBatch });
		batchesEnqueued += 1;
		rowsEnqueued += pendingBatch.length;
		pendingBatch = [];
	};

	while (true) {
		const page = await fetchNextPage(scopeWhere, cursor);
		if (page.length === 0) break;

		for (const row of page) {
			pendingBatch.push({ archivedEmailId: row.id });
			if (pendingBatch.length >= batchSize) {
				await flushBatch();
			}
		}

		const last = page[page.length - 1];
		cursor = { archivedAt: last.archivedAt, id: last.id };

		const progress: ReindexProgress = {
			scope,
			rowsEnqueued: rowsEnqueued + pendingBatch.length,
			batchesEnqueued,
			lastCursor: {
				archivedAt: last.archivedAt.toISOString(),
				id: last.id,
			},
			finished: false,
		};
		await job.updateProgress(progress);

		if (page.length < PAGE_SIZE) break;
	}

	await flushBatch();

	const finalProgress: ReindexProgress = {
		scope,
		rowsEnqueued,
		batchesEnqueued,
		lastCursor: {
			archivedAt: cursor.archivedAt ? cursor.archivedAt.toISOString() : null,
			id: cursor.id,
		},
		finished: true,
	};
	await job.updateProgress(finalProgress);

	logger.info(
		{ jobId: job.id, scope, rowsEnqueued, batchesEnqueued },
		'Reindex orchestrator finished enqueueing batches'
	);

	return finalProgress;
}
