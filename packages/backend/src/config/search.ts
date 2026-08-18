import 'dotenv/config';
import { logger } from './logger';

/**
 * Reads a positive integer setting, falling back loudly rather than silently.
 *
 * `parseInt` is too forgiving to use directly for configuration. It returns `NaN` for a typo, and
 * `NaN` propagates: a chunk size of `NaN` makes the indexing loop iterate once over an empty slice
 * and report success, leaving every row unindexed with nothing in the log to say so. Worse, it stops
 * at the first character it cannot read, so `1_000_000` — the digit-separator style used for the
 * defaults in this very file, and an easy thing to paste into a `.env` — parses as `1`. A text budget
 * of one byte indexes every email with an empty body and marks it done.
 *
 * `min` is what catches that second case: a plausible-but-absurd value is rejected like a malformed
 * one.
 */
const intFromEnv = (name: string, fallback: number, min: number): number => {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === '') {
		return fallback;
	}

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < min) {
		logger.warn(
			{ variable: name, value: raw, min, using: fallback },
			'Ignoring out-of-range or unparseable configuration value'
		);
		return fallback;
	}
	return parsed;
};

export const searchConfig = {
	host: process.env.MEILI_HOST || 'http://127.0.0.1:7700',
	apiKey: process.env.MEILI_MASTER_KEY || '',
};

export const meiliConfig = {
	/**
	 * How many email ids one index-email-batch job carries — queue granularity, not a memory dial.
	 * It also sets reconcile throughput: the reconcile tick enqueues at most `reconcilePageCap`
	 * JOBS, so each id here multiplies how many emails one tick can drain. Use MEILI_INDEXING_CHUNK
	 * to bound memory.
	 */
	indexingBatchSize: intFromEnv('MEILI_INDEXING_BATCH', 500, 1),
	/**
	 * How many documents are built and pushed to Meilisearch at a time within one job.
	 * This, not the batch size, is what bounds the worker's peak memory: a job holds one chunk of
	 * built documents, not all of them. Raising it trades memory for fewer round trips.
	 */
	indexingChunkSize: intFromEnv('MEILI_INDEXING_CHUNK', 25, 1),
	/** Max milliseconds to wait for a Meilisearch task to finish before treating
	 * the batch as failed (so BullMQ retries it). */
	waitForTaskTimeoutMs: intFromEnv('MEILI_WAIT_FOR_TASK_TIMEOUT', 300_000, 1_000),
};

/**
 * Index reliability / self-healing knobs. All env-tunable so operators can
 * throttle the reconcile loop at millions-of-emails scale.
 */
export const indexingConfig = {
	/** Enable the periodic reconcile-index self-healing job. */
	reconcileEnabled: process.env.INDEX_RECONCILE_ENABLED
		? process.env.INDEX_RECONCILE_ENABLED === 'true'
		: true,
	/** Cron pattern for the reconcile scheduler (default: every 30 minutes). */
	reconcileCron: process.env.INDEX_RECONCILE_CRON || '*/30 * * * *',
	/** Max number of index-email-batch pages the reconcile job enqueues per tick,
	 * so a huge backlog drains over several ticks instead of flooding Redis/Meili. */
	reconcilePageCap: intFromEnv('INDEX_RECONCILE_PAGE_CAP', 20, 1),
	/** If the indexing queue already has at least this many waiting+active JOBS,
	 * the reconcile tick defers (backpressure) to avoid piling on during imports. */
	reconcileBackpressureThreshold: intFromEnv('INDEX_RECONCILE_BACKPRESSURE', 100, 1),
	/**
	 * Stop retrying an email after this many failed indexing attempts (poison-pill guard).
	 * Kept above one BullMQ job's attempt count (5), so a row needs to fail across more than a
	 * single job lifecycle before it is abandoned by the reconcile scan.
	 */
	maxIndexAttempts: intFromEnv('MAX_INDEX_ATTEMPTS', 8, 1),
	/**
	 * Upper bound on extracted text kept per attachment and per document body. Text past this point
	 * adds nothing a search will find, but a single scanned PDF or spreadsheet can otherwise turn
	 * into tens of megabytes of string held in the worker's heap for the whole chunk.
	 */
	maxTextBytes: intFromEnv('INDEXING_MAX_TEXT_BYTES', 1_000_000, 10_000),
};
