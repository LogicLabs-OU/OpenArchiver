import { Queue } from 'bullmq';
import { connection } from '../config/redis';

// Default job options
const defaultJobOptions = {
	attempts: 5,
	backoff: {
		type: 'exponential',
		delay: 1000,
	},
	removeOnComplete: {
		count: 1000,
	},
	removeOnFail: {
		count: 5000,
	},
};

export const ingestionQueue = new Queue('ingestion', {
	connection,
	defaultJobOptions,
});

export const indexingQueue = new Queue('indexing', {
	connection,
	defaultJobOptions,
});

// Queue for the Data Lifecycle Manager (retention policy enforcement)
export const complianceLifecycleQueue = new Queue('compliance-lifecycle', {
	connection,
	defaultJobOptions,
});

// Queue for the reindex orchestrator. Producer drains `archived_emails` in
// cursor-paginated pages and enqueues `index-email-batch` jobs onto
// `indexingQueue`. See ReindexService / reindex-emails.processor.
export const reindexQueue = new Queue('reindex', {
	connection,
	defaultJobOptions,
});

// Queue for the original-date backfill (issue #372). A planner job paginates
// `archived_emails WHERE date_backfilled_at IS NULL` and enqueues batch jobs
// on the same queue. Each batch job re-parses the raw EML, applies the
// dateExtractor fallback chain, updates `sent_at` / `original_date_source` /
// `date_backfilled_at`, and enqueues a single `index-email-batch` job on
// `indexingQueue` for the rows whose sent_at actually changed.
//
// This is intentionally a separate queue from `reindexQueue` — different
// purpose (writes to Postgres, then enqueues onto indexingQueue) and a
// different cadence (idempotent resume via the `date_backfilled_at` flag,
// no cursor state held in Redis).
export const dateBackfillQueue = new Queue('date-backfill', {
	connection,
	defaultJobOptions,
});
