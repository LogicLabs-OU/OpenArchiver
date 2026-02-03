import { Job, Queue } from 'bullmq';
import { ingestionQueue, indexingQueue } from '../jobs/queues';
import { IJob, IQueueCounts, IQueueDetails, IQueueOverview, JobStatus } from '@open-archiver/types';

export class JobsService {
	private queues: Queue[];

	constructor() {
		this.queues = [ingestionQueue, indexingQueue];
	}

	public async getQueues(): Promise<IQueueOverview[]> {
		const queueOverviews: IQueueOverview[] = [];
		for (const queue of this.queues) {
			const counts = await queue.getJobCounts(
				'active',
				'completed',
				'failed',
				'delayed',
				'waiting',
				'paused'
			);
			queueOverviews.push({
				name: queue.name,
				counts: {
					active: counts.active || 0,
					completed: counts.completed || 0,
					failed: counts.failed || 0,
					delayed: counts.delayed || 0,
					waiting: counts.waiting || 0,
					paused: counts.paused || 0,
				},
			});
		}
		return queueOverviews;
	}

	public async getQueueDetails(
		queueName: string,
		status: JobStatus,
		page: number,
		limit: number
	): Promise<IQueueDetails> {
		const queue = this.queues.find((q) => q.name === queueName);
		if (!queue) {
			throw new Error(`Queue ${queueName} not found`);
		}

		const counts = await queue.getJobCounts(
			'active',
			'completed',
			'failed',
			'delayed',
			'waiting',
			'paused'
		);
		const start = (page - 1) * limit;
		const end = start + limit - 1;
		const jobStatus = status === 'waiting' ? 'wait' : status;
		const jobs = await queue.getJobs([jobStatus], start, end, true);
		const totalJobs = await queue.getJobCountByTypes(jobStatus);

		return {
			name: queue.name,
			counts: {
				active: counts.active || 0,
				completed: counts.completed || 0,
				failed: counts.failed || 0,
				delayed: counts.delayed || 0,
				waiting: counts.waiting || 0,
				paused: counts.paused || 0,
			},
			jobs: await Promise.all(jobs.map((job) => this.formatJob(job))),
			pagination: {
				currentPage: page,
				totalPages: Math.ceil(totalJobs / limit),
				totalJobs,
				limit,
			},
		};
	}

	private async formatJob(job: Job): Promise<IJob> {
		const state = await job.getState();
		return {
			id: job.id,
			name: job.name,
			data: job.data,
			state: state,
			failedReason: job.failedReason,
			timestamp: job.timestamp,
			processedOn: job.processedOn,
			finishedOn: job.finishedOn,
			attemptsMade: job.attemptsMade,
			stacktrace: job.stacktrace,
			returnValue: job.returnvalue,
			ingestionSourceId: job.data.ingestionSourceId,
			error: state === 'failed' ? job.stacktrace : undefined,
		};
	}
}
