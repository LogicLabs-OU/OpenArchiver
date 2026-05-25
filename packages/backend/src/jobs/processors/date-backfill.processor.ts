import { Job } from 'bullmq';
import { and, asc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import { simpleParser } from 'mailparser';
import type { OriginalDateSource } from '@open-archiver/types';
import { dateBackfillQueue, indexingQueue } from '../queues';
import { DatabaseService } from '../../services/DatabaseService';
import { StorageService } from '../../services/StorageService';
import { archivedEmails } from '../../database/schema';
import { streamToBuffer } from '../../helpers/streamToBuffer';
import { extractOriginalDate } from '../../helpers/dateExtractor';
import { logger } from '../../config/logger';

/**
 * Job payload for the planner job (`date-backfill:plan`). The planner scans
 * `archived_emails` for rows where `date_backfilled_at IS NULL`, optionally
 * narrowed to a single ingestion source, and fan-outs `date-backfill:batch`
 * jobs onto the same queue.
 *
 * Resume semantics: the SELECT filters by `date_backfilled_at IS NULL`, so a
 * killed planner just picks up where it left off on the next run. No cursor
 * state is held in Redis.
 */
export interface DateBackfillPlanJobData {
	ingestionSourceId?: string;
	/** Number of rows per batch job. Defaults to 100. */
	batchSize?: number;
}

/**
 * Job payload for a single batch (`date-backfill:batch`). The planner attaches
 * its own job id (`plannerJobId`) so the batch can update the planner-scoped
 * counter hash in Redis.
 */
export interface DateBackfillBatchJobData {
	archivedEmailIds: string[];
	plannerJobId: string;
}

/**
 * Progress snapshot stored on the planner job (also mirrored to Redis hash for
 * batch-side updates). Counters are eventually consistent — batches increment
 * via `HINCRBY` and the planner reads them back on demand.
 */
export interface DateBackfillProgress {
	total: number;
	scanned: number;
	updated: number;
	failed: number;
	enqueuedBatches: number;
	finished: boolean;
}

const DEFAULT_BATCH_SIZE = 100;
const PAGE_SIZE = 500;

/** 1h tolerance — if the existing `sent_at` is within this of the extractor
 * result we don't bother updating. Avoids index churn for clock-skewed dates. */
const SENT_AT_DRIFT_TOLERANCE_MS = 60 * 60 * 1000;

const databaseService = new DatabaseService();
const storageService = new StorageService();

/** Redis hash key used to share counters between the planner job and its
 * spawned batch jobs. Keyed by planner job id so multiple concurrent backfills
 * don't collide. */
export function runCounterKey(plannerJobId: string): string {
	return `date-backfill:run:${plannerJobId}`;
}

/**
 * Returns the BullMQ-managed ioredis client. We piggyback on the queue's
 * connection rather than opening a new one — keeps connection count flat
 * and reuses the pool BullMQ already manages.
 */
async function getRedis() {
	return dateBackfillQueue.client;
}

/**
 * Compare two dates: returns true when they are more than the drift tolerance
 * apart (i.e. the row should be updated).
 */
function shouldUpdateForDrift(existing: Date, candidate: Date): boolean {
	return Math.abs(existing.getTime() - candidate.getTime()) > SENT_AT_DRIFT_TOLERANCE_MS;
}

/**
 * Decide whether a row needs an update based on its current values and the
 * extractor output. Pure function — exported for unit tests.
 */
export function decideRowUpdate(args: {
	currentSentAt: Date | null;
	currentSource: OriginalDateSource;
	extractedDate: Date | null;
	extractedSource: OriginalDateSource;
}): { update: boolean; reason: string } {
	const { currentSentAt, currentSource, extractedDate, extractedSource } = args;

	if (currentSentAt === null && extractedDate !== null) {
		return { update: true, reason: 'fills-null-sent-at' };
	}

	if (currentSentAt !== null && extractedDate !== null) {
		if (shouldUpdateForDrift(currentSentAt, extractedDate)) {
			return { update: true, reason: 'sent-at-drift-exceeds-tolerance' };
		}
	}

	if (currentSource !== extractedSource) {
		return { update: true, reason: 'source-changed' };
	}

	return { update: false, reason: 'no-change' };
}

/**
 * Top-level processor — dispatches based on `job.name`.
 */
export default async function dateBackfillProcessor(
	job: Job<DateBackfillPlanJobData | DateBackfillBatchJobData>
): Promise<DateBackfillProgress | { processedIds: number; updated: number; failed: number }> {
	if (job.name === 'date-backfill:plan') {
		return runPlanner(job as Job<DateBackfillPlanJobData>);
	}
	if (job.name === 'date-backfill:batch') {
		return runBatch(job as Job<DateBackfillBatchJobData>);
	}
	throw new Error(`Unknown date-backfill job name: ${job.name}`);
}

/**
 * Planner: counts work, paginates ids, fan-outs batch jobs onto the same
 * queue. Does NOT wait for batches to finish — its own state goes to
 * `completed` once enqueuing is done. The counter hash in Redis is the
 * source of truth for end-to-end progress.
 */
async function runPlanner(
	job: Job<DateBackfillPlanJobData>
): Promise<DateBackfillProgress> {
	const batchSize = job.data.batchSize ?? DEFAULT_BATCH_SIZE;
	const ingestionSourceId = job.data.ingestionSourceId;
	const plannerJobId = job.id;
	if (!plannerJobId) {
		throw new Error('Planner job has no id — cannot key counter hash');
	}

	const baseWhere = ingestionSourceId
		? and(isNull(archivedEmails.dateBackfilledAt), eq(archivedEmails.ingestionSourceId, ingestionSourceId))
		: isNull(archivedEmails.dateBackfilledAt);

	const [{ count }] = (await databaseService.db
		.select({ count: sql<number>`count(*)::int` })
		.from(archivedEmails)
		.where(baseWhere)) as Array<{ count: number }>;

	const total = Number(count) || 0;

	const redis = await getRedis();
	const key = runCounterKey(plannerJobId);
	await redis.hset(key, {
		total: String(total),
		scanned: '0',
		updated: '0',
		failed: '0',
		enqueuedBatches: '0',
	});
	// Counters outlive the planner run by 30d so the status endpoint can still
	// surface progress after restart. Refreshed on every batch HINCRBY.
	await redis.expire(key, 60 * 60 * 24 * 30);

	logger.info(
		{ jobId: plannerJobId, total, batchSize, ingestionSourceId },
		'date-backfill planner: scan count complete'
	);

	let lastId: string | null = null;
	let enqueuedBatches = 0;
	let pending: string[] = [];

	const flush = async (): Promise<void> => {
		if (pending.length === 0) return;
		await dateBackfillQueue.add('date-backfill:batch', {
			archivedEmailIds: pending,
			plannerJobId,
		} satisfies DateBackfillBatchJobData);
		enqueuedBatches += 1;
		pending = [];
	};

	while (true) {
		const pageWhere: SQL | undefined = lastId
			? and(baseWhere, gt(archivedEmails.id, lastId))
			: baseWhere;

		const page = await databaseService.db
			.select({ id: archivedEmails.id })
			.from(archivedEmails)
			.where(pageWhere)
			.orderBy(asc(archivedEmails.id))
			.limit(PAGE_SIZE);

		if (page.length === 0) break;

		for (const row of page) {
			pending.push(row.id);
			if (pending.length >= batchSize) {
				await flush();
			}
		}

		lastId = page[page.length - 1].id;

		await redis.hset(key, { enqueuedBatches: String(enqueuedBatches) });
		await job.updateProgress({
			total,
			scanned: 0,
			updated: 0,
			failed: 0,
			enqueuedBatches,
			finished: false,
		});

		if (page.length < PAGE_SIZE) break;
	}

	await flush();
	await redis.hset(key, { enqueuedBatches: String(enqueuedBatches) });

	const finalProgress: DateBackfillProgress = {
		total,
		scanned: 0,
		updated: 0,
		failed: 0,
		enqueuedBatches,
		finished: true,
	};
	await job.updateProgress(finalProgress);

	logger.info(
		{ jobId: plannerJobId, total, enqueuedBatches },
		'date-backfill planner: enqueueing complete'
	);

	return finalProgress;
}

/**
 * Batch worker — for each id, re-parse the EML, run the extractor, and update
 * the row when something changed. Marks `date_backfilled_at = now()` on every
 * row it processes (including failures) so a re-run skips them.
 */
async function runBatch(
	job: Job<DateBackfillBatchJobData>
): Promise<{ processedIds: number; updated: number; failed: number }> {
	const { archivedEmailIds, plannerJobId } = job.data;
	const redis = await getRedis();
	const key = runCounterKey(plannerJobId);

	let processed = 0;
	let updated = 0;
	let failed = 0;
	const changedIds: string[] = [];

	for (const id of archivedEmailIds) {
		processed += 1;

		const row = await databaseService.db
			.select({
				id: archivedEmails.id,
				sentAt: archivedEmails.sentAt,
				originalDateSource: archivedEmails.originalDateSource,
				storagePath: archivedEmails.storagePath,
				ingestionSourceId: archivedEmails.ingestionSourceId,
			})
			.from(archivedEmails)
			.where(eq(archivedEmails.id, id))
			.limit(1);

		if (row.length === 0) {
			logger.warn({ id }, 'date-backfill: row vanished before processing');
			failed += 1;
			continue;
		}

		const r = row[0];

		try {
			const stream = await storageService.get(r.storagePath);
			const raw = await streamToBuffer(stream);
			const parsed = await simpleParser(raw);
			const { date, source } = extractOriginalDate(parsed, raw);

			const decision = decideRowUpdate({
				currentSentAt: r.sentAt,
				currentSource: r.originalDateSource as OriginalDateSource,
				extractedDate: date,
				extractedSource: source,
			});

			if (decision.update) {
				await databaseService.db
					.update(archivedEmails)
					.set({
						sentAt: date,
						originalDateSource: source,
						dateBackfilledAt: new Date(),
					})
					.where(eq(archivedEmails.id, id));
				updated += 1;
				changedIds.push(id);
			} else {
				await databaseService.db
					.update(archivedEmails)
					.set({ dateBackfilledAt: new Date() })
					.where(eq(archivedEmails.id, id));
			}
		} catch (err) {
			// Mark scanned to skip on resume — the row's storage is unreadable
			// or the parser blew up, retrying won't help.
			logger.warn(
				{ id, err: err instanceof Error ? err.message : String(err) },
				'date-backfill: per-row failure, marking scanned'
			);
			try {
				await databaseService.db
					.update(archivedEmails)
					.set({ dateBackfilledAt: new Date() })
					.where(eq(archivedEmails.id, id));
			} catch (innerErr) {
				logger.error(
					{ id, err: innerErr },
					'date-backfill: failed to mark row as scanned after failure'
				);
			}
			failed += 1;
		}
	}

	// Push a single reindex batch for the rows that actually changed.
	if (changedIds.length > 0) {
		await indexingQueue.add('index-email-batch', {
			emails: changedIds.map((archivedEmailId) => ({ archivedEmailId })),
		});
	}

	// Update shared counters. HINCRBY is atomic so concurrent batches don't
	// race each other.
	await redis.hincrby(key, 'scanned', processed);
	await redis.hincrby(key, 'updated', updated);
	await redis.hincrby(key, 'failed', failed);
	// Refresh TTL so a long-running backfill doesn't expire mid-flight.
	await redis.expire(key, 60 * 60 * 24 * 30);

	logger.info(
		{ jobId: job.id, plannerJobId, processed, updated, failed },
		'date-backfill batch complete'
	);

	return { processedIds: processed, updated, failed };
}
