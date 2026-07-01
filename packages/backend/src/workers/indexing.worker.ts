import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import indexEmailBatchProcessor from '../jobs/processors/index-email-batch.processor';
import { logger } from '../config/logger';

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

logger.info('Indexing worker started');

process.on('SIGINT', () => worker.close());
process.on('SIGTERM', () => worker.close());

// pdf2json can emit an unhandled promise rejection deep in its image parsing
// (e.g. "Bits per component missing in image") that bypasses the pdfParser
// error events and would otherwise crash the whole worker process. Keep the
// process alive so the affected job resolves empty (via the textExtractor
// timeout) and BullMQ can move on to the next email instead of indexing halting.
process.on('unhandledRejection', (reason: unknown) => {
	const message = reason instanceof Error ? reason.message : String(reason);
	logger.warn({ reason: message }, 'Unhandled rejection in indexing worker (suppressed)');
});
process.on('uncaughtException', (err: unknown) => {
	const message = err instanceof Error ? err.message : String(err);
	logger.error({ err: message }, 'Uncaught exception in indexing worker (suppressed)');
});
