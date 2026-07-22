import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import indexEmailBatchProcessor from '../jobs/processors/index-email-batch.processor';
import reindexProcessor from '../jobs/processors/reindex.processor';
import reconcileIndexProcessor from '../jobs/processors/reconcile-index.processor';
import { logger } from '../config/logger';

const processor = async (job: any) => {
	switch (job.name) {
		case 'index-email-batch':
			return indexEmailBatchProcessor(job);
		case 'reindex':
			return reindexProcessor(job);
		case 'reconcile-index':
			return reconcileIndexProcessor(job);
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

// Last-resort telemetry net for rejections/throws that ESCAPE a job's promise chain — e.g.
// pdf2json emitting an async "Bits per component missing in image" on a later tick, which no
// processor-level try/catch can catch. Without this, Node crashes the worker, and because
// workers run under `concurrently` it is never restarted, so ALL indexing silently halts
// while emails keep archiving. Note: this does NOT re-run the offending job — an escaped
// rejection is disconnected from BullMQ, so that write is dropped. It is not lost for good:
// the row stays is_indexed=false and the reconcile-index job re-enqueues it. Ordinary errors
// thrown inside a job's promise are still rejected and retried by BullMQ as usual; only
// genuinely-escaped async failures land here.
process.on('unhandledRejection', (reason) => {
	logger.error({ reason }, 'Unhandled promise rejection in indexing worker - continuing');
});
process.on('uncaughtException', (err) => {
	logger.error({ err }, 'Uncaught exception in indexing worker - continuing');
});

process.on('SIGINT', () => worker.close());
process.on('SIGTERM', () => worker.close());
