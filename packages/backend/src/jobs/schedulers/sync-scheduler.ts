import { ingestionQueue, indexingQueue } from '../queues';

import { config } from '../../config';
import { logger } from '@open-archiver/backend/config/logger';

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

Promise.all([scheduleContinuousSync(), scheduleIndexReconcile()]).then(() => {
	logger.info('Continuous sync + index reconcile schedulers started.');
});
