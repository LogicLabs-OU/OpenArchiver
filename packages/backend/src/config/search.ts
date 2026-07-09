import 'dotenv/config';

export const searchConfig = {
	host: process.env.MEILI_HOST || 'http://127.0.0.1:7700',
	apiKey: process.env.MEILI_MASTER_KEY || '',
};

export const meiliConfig = {
	indexingBatchSize: process.env.MEILI_INDEXING_BATCH
		? parseInt(process.env.MEILI_INDEXING_BATCH)
		: 500,
	/** Max milliseconds to wait for a Meilisearch task to finish before treating
	 * the batch as failed (so BullMQ retries it). */
	waitForTaskTimeoutMs: process.env.MEILI_WAIT_FOR_TASK_TIMEOUT
		? parseInt(process.env.MEILI_WAIT_FOR_TASK_TIMEOUT)
		: 300_000,
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
	reconcilePageCap: process.env.INDEX_RECONCILE_PAGE_CAP
		? parseInt(process.env.INDEX_RECONCILE_PAGE_CAP)
		: 20,
	/** If the indexing queue already has at least this many waiting+active jobs,
	 * the reconcile tick defers (backpressure) to avoid piling on during imports. */
	reconcileBackpressureThreshold: process.env.INDEX_RECONCILE_BACKPRESSURE
		? parseInt(process.env.INDEX_RECONCILE_BACKPRESSURE)
		: 100,
	/** Stop retrying an email after this many failed indexing attempts (poison-pill guard). */
	maxIndexAttempts: process.env.MAX_INDEX_ATTEMPTS
		? parseInt(process.env.MAX_INDEX_ATTEMPTS)
		: 5,
};
