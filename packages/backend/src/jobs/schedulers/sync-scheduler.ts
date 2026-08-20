import type { Queue } from 'bullmq';
import { ingestionQueue, indexingQueue } from '../queues';

import { config } from '../../config';
import { logger } from '../../config/logger';
import { exitOnSignals } from '../../workers/supervision';
import { explainRedisAuthError } from '../../config/redisAuthHint';

/**
 * Removes every existing repeatable registration under a name, so the one added next is the only one.
 *
 * A repeatable job's key encodes its pattern, so changing SYNC_FREQUENCY registers a *second* entry
 * rather than replacing the first — and BullMQ has changed the key format across versions, which
 * leaves an upgraded deployment carrying registrations it can no longer match. Nothing ever removed
 * them, so every one of them kept firing: the dev instance had accumulated three
 * schedule-continuous-sync registrations, two of them firing on the same minute boundary. Each tick
 * dispatches a cycle per source, so the extra ticks were the origin of the concurrent
 * process-mailbox jobs that duplicated archived mail.
 *
 * Removal is by key, which is exactly what getRepeatableJobs returns, so it reaches legacy-format
 * entries too. Several scheduler replicas starting at once converge on the same single registration
 * because the key is derived from the name and pattern rather than from who wrote it.
 */
const clearRepeatable = async (queue: Queue, name: string): Promise<void> => {
	const existing = await queue.getRepeatableJobs();
	for (const job of existing) {
		if (job.name !== name) {
			continue;
		}
		await queue.removeRepeatableByKey(job.key);
		logger.info(
			{ queue: queue.name, name, key: job.key, pattern: job.pattern },
			'Removed a superseded repeatable job registration'
		);
	}
};

const scheduleContinuousSync = async () => {
	await clearRepeatable(ingestionQueue, 'schedule-continuous-sync');
	await ingestionQueue.add(
		'schedule-continuous-sync',
		{},
		{
			jobId: 'schedule-continuous-sync',
			repeat: {
				pattern: config.app.syncFrequency,
			},
		}
	);
};

// Periodic self-healing: re-queue emails that never made it into the search index.
// Registered here (the existing scheduler process) so no new container is needed.
const scheduleIndexReconcile = async () => {
	if (!config.indexing.reconcileEnabled) {
		logger.info('Index reconcile scheduler disabled via config.');
		return;
	}
	await clearRepeatable(indexingQueue, 'reconcile-index');
	await indexingQueue.add(
		'reconcile-index',
		{},
		{
			jobId: 'reconcile-index',
			repeat: {
				pattern: config.indexing.reconcileCron,
			},
		}
	);
};

// A Redis error here is not cosmetic: this process registers the repeatable reconcile job that every
// other self-healing path in the indexing pipeline falls back on. Left unhandled the rejection just
// terminated the process with no explanation, so fail loudly and let the supervisor retry.
[ingestionQueue, indexingQueue].forEach((queue) => {
	queue.on('error', (err) => {
		logger.error({ err, queue: queue.name }, 'Scheduler queue error');
		explainRedisAuthError(err);
	});
});

// Same shutdown contract as the workers, and needed for the same reason: this process sits under the
// same `concurrently --restart-tries -1`, which respawns any child that closes non-zero. Without a
// handler it died by signal, was restarted five seconds into `docker stop`, and kept the whole tree
// alive until Docker resorted to SIGKILL.
exitOnSignals('sync-scheduler', async () => {
	await Promise.all([ingestionQueue.close(), indexingQueue.close()]);
});

Promise.all([scheduleContinuousSync(), scheduleIndexReconcile()])
	.then(() => {
		logger.info('Continuous sync + index reconcile schedulers started.');
	})
	.catch((err) => {
		logger.fatal({ err }, 'Failed to register schedulers - exiting so the supervisor retries');
		process.exit(1);
	});
