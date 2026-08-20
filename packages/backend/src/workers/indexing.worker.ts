import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import indexEmailBatchProcessor from '../jobs/processors/index-email-batch.processor';
import reindexProcessor from '../jobs/processors/reindex.processor';
import reconcileIndexProcessor from '../jobs/processors/reconcile-index.processor';
import cleanupOrphansProcessor from '../jobs/processors/cleanup-orphans.processor';
import { logger } from '../config/logger';
import { config } from '../config';
import { superviseWorker } from './supervision';

const processor = async (job: any) => {
	switch (job.name) {
		case 'index-email-batch':
			return indexEmailBatchProcessor(job);
		case 'reindex':
			return reindexProcessor(job);
		case 'reconcile-index':
			return reconcileIndexProcessor(job);
		case 'cleanup-orphans':
			return cleanupOrphansProcessor(job);
		default:
			throw new Error(`Unknown job name: ${job.name}`);
	}
};

const worker = new Worker('indexing', processor, {
	connection,
	// Left unset, this defaulted to 1, and a job spends most of its life waiting rather than
	// computing — a storage read per email, then a Meilisearch task it must see finish before it may
	// mark those emails indexed. One job at a time turned that wait into idle time: measured in
	// production at roughly three seconds per single-email job with 286 of them queued behind it.
	// See config.indexing.workerConcurrency for how this multiplies peak memory.
	concurrency: config.indexing.workerConcurrency,
	// Building a document is largely synchronous work — mailparser, pdf2json, xlsx — and one large
	// message can hold the event loop long enough that automatic lock renewal (every lockDuration/2)
	// misses its window, at which point BullMQ declares the still-running job stalled. A 10-minute
	// lock tolerates those stretches.
	//
	// maxStalledCount stays at the default 1 here, unlike the ingestion worker. Its reason for 0 is a
	// dedup race that duplicates archived mail, which does not exist on this side: Meilisearch upserts
	// by document id and markIndexed is idempotent, so a second run of the same job costs work and
	// nothing else. Meanwhile 0 has a real cost — every job in flight when the process exits (the
	// watchdog, an OOM kill, a deploy) is failed outright, skipping its remaining attempts.
	lockDuration: 10 * 60 * 1000,
	removeOnComplete: {
		count: 100, // keep last 100 jobs
	},
	removeOnFail: {
		count: 500, // keep last 500 failed jobs
	},
});

superviseWorker(worker);

logger.info('Indexing worker started');

// Last-resort telemetry net for rejections/throws that ESCAPE a job's promise chain — e.g.
// pdf2json emitting an async "Bits per component missing in image" on a later tick, which no
// processor-level try/catch can catch. Without this, one such failure takes the process down.
// It does NOT re-run the offending job: an escaped rejection is disconnected from BullMQ, so that
// write is dropped. It is not lost for good — the row stays is_indexed=false and reconcile-index
// re-enqueues it. Ordinary errors thrown inside a job's promise are still rejected and retried by
// BullMQ as usual; only genuinely-escaped async failures land here.
//
// What this does NOT do, despite how it reads, is keep the WORKER alive. It keeps the PROCESS
// alive, and those are different things: BullMQ's run loop can be stopped while the process lives
// on, consuming nothing. superviseWorker() above is what catches that, by checking isRunning() and
// exiting so the supervisor can restart.
process.on('unhandledRejection', (reason) => {
	logger.error({ reason }, 'Unhandled promise rejection in indexing worker - continuing');
});
process.on('uncaughtException', (err) => {
	logger.error({ err }, 'Uncaught exception in indexing worker - continuing');
});
