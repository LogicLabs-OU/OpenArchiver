import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import indexEmailProcessor from '../jobs/processors/index-email.processor';
import { ocrService } from '../services/OcrService';
import { logger } from '../config/logger';

const processor = async (job: any) => {
	switch (job.name) {
		case 'index-email':
			return indexEmailProcessor(job);
		default:
			throw new Error(`Unknown job name: ${job.name}`);
	}
};

const worker = new Worker('indexing', processor, {
	connection,
	concurrency: 5,
	removeOnComplete: {
		count: 1000, // keep last 1000 jobs
	},
	removeOnFail: {
		count: 5000, // keep last 5000 failed jobs
	},
});

logger.info('Indexing worker started');

const gracefulShutdown = async () => {
	logger.info('Shutting down indexing worker...');
	await worker.close();
	await ocrService.terminate();
	process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
