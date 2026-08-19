import { ingestionQueue, indexingQueue } from '../queues';

import { config } from '../../config';
import { logger } from '../../config/logger';
import { exitOnSignals } from '../../workers/supervision';
import { explainRedisAuthError } from '../../config/redisAuthHint';

const scheduleContinuousSync = async () => {
	// This job will run every 15 minutes
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
