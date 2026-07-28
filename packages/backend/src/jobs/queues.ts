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

/**
 * Queues exposed on the admin jobs page. Enterprise-only queues (declared in
 * the enterprise package, which backend must never import from) register
 * themselves at module initialization, so an OSS deployment never shows a
 * queue nothing feeds. Read through getAdminQueues() rather than captured in
 * a constructor — JobsService is instantiated when the routes module loads,
 * which happens before enterprise modules initialize.
 */
const adminQueues: Queue[] = [ingestionQueue, indexingQueue];

export const registerAdminQueue = (queue: Queue): void => {
	if (!adminQueues.includes(queue)) {
		adminQueues.push(queue);
	}
};

export const getAdminQueues = (): Queue[] => adminQueues;
