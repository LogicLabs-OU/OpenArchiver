import { Worker } from 'bullmq';
import { connection } from '../config/redis';
import indexEmailProcessor from '../jobs/processors/index-email.processor';

const processor = async (job: any) => {
    switch (job.name) {
        case 'index-email':
            return indexEmailProcessor(job);
        default:
            throw new Error(`Unknown job name: ${job.name}`);
    }
};

const worker = new Worker('indexing', processor, {
    connection,
    concurrency: 5,
    removeOnComplete: {
        count: 1000, // keep last 1000 jobs
    },
    removeOnFail: {
        count: 5000, // keep last 5000 failed jobs
    },
});

console.log('Indexing worker started');

process.on('SIGINT', () => worker.close());
process.on('SIGTERM', () => worker.close());
