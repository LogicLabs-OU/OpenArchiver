import { Queue, FlowProducer } from 'bullmq';
import { connection } from '../config/redis';
import { logger } from '../config/logger';

export const flowProducer = new FlowProducer({ connection });

flowProducer.on('error', (err) => {
	logger.error(err, 'FlowProducer connection error');
});

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

ingestionQueue.on('error', (err) => {
	logger.error(err, 'Ingestion queue connection error');
});

export const indexingQueue = new Queue('indexing', {
	connection,
	defaultJobOptions,
});

indexingQueue.on('error', (err) => {
	logger.error(err, 'Indexing queue connection error');
});
