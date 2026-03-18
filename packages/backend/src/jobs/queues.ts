import { Queue } from 'bullmq';
import { connection } from '../config/redis';

// Default job options
const defaultJobOptions = {
	attempts: 5,
	backoff: {
		type: 'exponential',
		delay: 1000,
	},
	removeOnComplete: {
		count: 1000,
	},
	removeOnFail: {
		count: 5000,
	},
};

export const ingestionQueue = new Queue('ingestion', {
	connection,
	defaultJobOptions,
});

export const indexingQueue = new Queue('indexing', {
	connection,
	defaultJobOptions,
});

// Queue for the Data Lifecycle Manager (retention policy enforcement)
export const complianceLifecycleQueue = new Queue('compliance-lifecycle', {
	connection,
	defaultJobOptions,
});
