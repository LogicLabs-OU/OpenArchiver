import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import dateBackfillProcessor from '../jobs/processors/date-backfill.processor';
import { logger } from '../config/logger';

const processor = async (job: any) => {
	switch (job.name) {
		case 'date-backfill:plan':
		case 'date-backfill:batch':
			return dateBackfillProcessor(job);
		default:
			throw new Error(`Unknown job name: ${job.name}`);
	}
};

// Default concurrency 1: the planner is a single producer and per-batch jobs
// hit Postgres + storage + the indexing queue. Override via
// DATE_BACKFILL_WORKER_CONCURRENCY when running disjoint scopes against a
// hot storage backend.
const concurrency =
	Number.parseInt(process.env.DATE_BACKFILL_WORKER_CONCURRENCY ?? '1', 10) || 1;

const worker = new Worker('date-backfill', processor, {
	connection,
	concurrency,
	removeOnComplete: {
		count: 50,
	},
	removeOnFail: {
		count: 200,
	},
});

logger.info({ concurrency }, 'Date-backfill worker started');

process.on('SIGINT', () => worker.close());
process.on('SIGTERM', () => worker.close());
