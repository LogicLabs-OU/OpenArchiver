import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import indexEmailBatchProcessor from '../jobs/processors/index-email-batch.processor';

const processor = async (job: any) => {
	switch (job.name) {
		case 'index-email-batch':
			return indexEmailBatchProcessor(job);
		default:
			throw new Error(`Unknown job name: ${job.name}`);
	}
};

const worker = new Worker('indexing', processor, {
	connection,
	removeOnComplete: {
		count: 100, // keep last 100 jobs
	},
	removeOnFail: {
		count: 500, // keep last 500 failed jobs
	},
});

console.log('Indexing worker started');

const shutdown = async (signal: string) => {
	console.log(`${signal} received, shutting down indexing worker...`);
	try {
		await worker.close(); // waits for worker to stop (and active job to finish)
		console.log('Indexing worker closed');
		process.exit(0);
	} catch (err) {
		console.error('Failed to close indexing worker', err);
		process.exit(1);
	}
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
