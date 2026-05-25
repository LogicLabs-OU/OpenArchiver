import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import reindexEmailsProcessor from '../jobs/processors/reindex-emails.processor';
import { logger } from '../config/logger';

const processor = async (job: any) => {
	switch (job.name) {
		case 'reindex-emails':
			return reindexEmailsProcessor(job);
		default:
			throw new Error(`Unknown job name: ${job.name}`);
	}
};

// Default concurrency 1 because the orchestrator is a producer that floods the
// indexing queue. Two orchestrators in parallel just double-enqueue. Override
// via REINDEX_WORKER_CONCURRENCY only when running disjoint scopes.
const concurrency = Number.parseInt(process.env.REINDEX_WORKER_CONCURRENCY ?? '1', 10) || 1;

const worker = new Worker('reindex', processor, {
	connection,
	concurrency,
	removeOnComplete: {
		count: 50,
	},
	removeOnFail: {
		count: 200,
	},
});

logger.info({ concurrency }, 'Reindex worker started');

process.on('SIGINT', () => worker.close());
process.on('SIGTERM', () => worker.close());
