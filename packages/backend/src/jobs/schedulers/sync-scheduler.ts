import { ingestionQueue } from '../queues';

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

scheduleContinuousSync().then(() => {
	logger.info('Continuous sync scheduler started.');
});
