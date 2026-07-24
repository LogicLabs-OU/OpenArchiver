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
	// Connector work (pst-extractor parsing, attachment reads, EML construction) is
	// largely synchronous, and one huge message can block the event loop long enough
	// that the automatic lock renewal (every lockDuration/2) misses its window. With
	// the default 30s lock, BullMQ then declares the still-running job stalled and
	// hands a second invocation of the SAME job to another worker slot — the two
	// invocations race the check-then-insert dedup and duplicate the archive.
	// A 10-minute lock tolerates long synchronous stretches, and maxStalledCount: 0
	// turns any residual stall into a failed job (recovered sequentially by the
	// scheduler, where dedup holds) instead of a silent concurrent double-run.
	lockDuration: 10 * 60 * 1000,
	maxStalledCount: 0,
	removeOnComplete: {
		count: 100, // keep last 100 jobs
	},
	removeOnFail: {
		count: 500, // keep last 500 failed jobs
	},
});

logger.info('Ingestion worker started');

// Last-resort telemetry net for rejections/throws that ESCAPE a job's promise chain. Without
// it, Node crashes the worker, which `concurrently` never restarts, stalling all ingestion.
// Ordinary errors thrown inside a job are rejected and retried by BullMQ as usual, and
// source-stream errors (e.g. EACCES on a locked file) are now surfaced at the connector so
// they reject the job too — so this net only catches genuinely-escaped async failures. It
// does NOT re-run the offending job (an escaped rejection is disconnected from BullMQ), so it
// logs and keeps the worker alive rather than letting one dropped job take the process down.
process.on('unhandledRejection', (reason) => {
	logger.error({ reason }, 'Unhandled promise rejection in ingestion worker - continuing');
});
process.on('uncaughtException', (err) => {
	logger.error({ err }, 'Uncaught exception in ingestion worker - continuing');
});

process.on('SIGINT', () => worker.close());
process.on('SIGTERM', () => worker.close());
