import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import initialImportProcessor from '../jobs/processors/initial-import.processor';
import continuousSyncProcessor from '../jobs/processors/continuous-sync.processor';
import scheduleContinuousSyncProcessor from '../jobs/processors/schedule-continuous-sync.processor';
import { processMailboxProcessor } from '../jobs/processors/process-mailbox.processor';
import syncCycleFinishedProcessor from '../jobs/processors/sync-cycle-finished.processor';
import { logger } from '../config/logger';

const processor = async (job: any) => {
	switch (job.name) {
		case 'initial-import':
			return initialImportProcessor(job);
		case 'sync-cycle-finished':
			return syncCycleFinishedProcessor(job);
		case 'continuous-sync':
			return continuousSyncProcessor(job);
		case 'schedule-continuous-sync':
			return scheduleContinuousSyncProcessor(job);
		case 'process-mailbox':
			return processMailboxProcessor(job);
		default:
			throw new Error(`Unknown job name: ${job.name}`);
	}
};

const worker = new Worker('ingestion', processor, {
	connection,
	// Configurable via INGESTION_WORKER_CONCURRENCY env var. Tune based on available RAM.
	concurrency: process.env.INGESTION_WORKER_CONCURRENCY
		? parseInt(process.env.INGESTION_WORKER_CONCURRENCY, 10)
		: 5,
	removeOnComplete: {
		count: 100, // keep last 100 jobs
	},
	removeOnFail: {
		count: 500, // keep last 500 failed jobs
	},
});

logger.info('Ingestion worker started');

process.on('SIGINT', () => worker.close());
process.on('SIGTERM', () => worker.close());
