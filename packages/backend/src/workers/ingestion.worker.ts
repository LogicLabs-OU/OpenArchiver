import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import initialImportProcessor from '../jobs/processors/initial-import.processor';
import continuousSyncProcessor from '../jobs/processors/continuous-sync.processor';
import scheduleContinuousSyncProcessor from '../jobs/processors/schedule-continuous-sync.processor';
import { processMailboxProcessor } from '../jobs/processors/process-mailbox.processor';
import syncCycleFinishedProcessor from '../jobs/processors/sync-cycle-finished.processor';

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
	removeOnComplete: {
		count: 100, // keep last 100 jobs
	},
	removeOnFail: {
		count: 500, // keep last 500 failed jobs
	},
});

console.log('Ingestion worker started');

const shutdown = async (signal: string) => {
	console.log(`${signal} received, shutting down ingestion worker...`);
	try {
		await worker.close(); // waits for worker to stop (and active job to finish)
		console.log('Ingestion worker closed');
		process.exit(0);
	} catch (err) {
		console.error('Failed to close ingestion worker', err);
		process.exit(1);
	}
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
