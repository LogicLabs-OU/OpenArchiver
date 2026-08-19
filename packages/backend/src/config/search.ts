import 'dotenv/config';
import { intFromEnv } from '../helpers/intFromEnv';

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
	/**
	 * How many index-email-batch jobs the indexing worker runs at once.
	 *
	 * Most of a job's wall clock is waiting, not computing: a storage read per email, then a
	 * Meilisearch task the job must see finish before it may mark those emails indexed. At the BullMQ
	 * default of 1 that wait is dead time — the worker sat idle with hundreds of jobs queued, which is
	 * what made small reindexes take tens of minutes.
	 *
	 * Memory scales with this: peak is roughly this value x 2 chunks in flight x MEILI_INDEXING_CHUNK
	 * documents x INDEXING_MAX_TEXT_BYTES, plus the raw .eml and attachment buffers of the documents
	 * currently building. Raise INDEXING_WORKER_MAX_OLD_SPACE_MB or lower MEILI_INDEXING_CHUNK when
	 * raising this.
	 */
	workerConcurrency: intFromEnv('INDEXING_WORKER_CONCURRENCY', 4, 1, 32),
};
