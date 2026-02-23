import { Job } from 'bullmq';
import { IngestionService } from '../../services/IngestionService';
import { IContinuousSyncJob } from '@open-archiver/types';
import { EmailProviderFactory } from '../../services/EmailProviderFactory';
import { flowProducer } from '../queues';
import { logger } from '../../config/logger';

export default async (job: Job<IContinuousSyncJob>) => {
	const { ingestionSourceId } = job.data;
	logger.info({ ingestionSourceId }, 'Starting continuous sync job.');

	const source = await IngestionService.findById(ingestionSourceId);
	if (!source || !['error', 'active'].includes(source.status)) {
		logger.warn(
			{ ingestionSourceId, status: source?.status },
			'Skipping continuous sync for non-active or non-error source.'
		);
		return;
	}

	await IngestionService.update(ingestionSourceId, {
		status: 'syncing',
		lastSyncStartedAt: new Date(),
	});

	const connector = EmailProviderFactory.createConnector(source);

	try {
		const jobs = [];
		for await (const user of connector.listAllUsers()) {
			if (user.primaryEmail) {
				jobs.push({
					name: 'process-mailbox',
					queueName: 'ingestion',
					data: {
						ingestionSourceId: source.id,
						userEmail: user.primaryEmail,
					},
					opts: {
						removeOnComplete: {
							age: 60 * 10, // 10 minutes
						},
						removeOnFail: {
							age: 60 * 30, // 30 minutes
						},
						timeout: 1000 * 60 * 30, // 30 minutes
					},
				});
			}
		}
		// }

		if (jobs.length > 0) {
			await flowProducer.add({
				name: 'sync-cycle-finished',
				queueName: 'ingestion',
				data: {
					ingestionSourceId,
					isInitialImport: false,
				},
				children: jobs,
				opts: {
					removeOnComplete: true,
					removeOnFail: true,
				},
			});
		} else {
			// No mailboxes were found — reset status so the source doesn't stay
			// stuck at 'syncing' and is picked up again on the next scheduler run.
			logger.warn(
				{ ingestionSourceId },
				'Continuous sync found no mailboxes; resetting status to active.'
			);
			await IngestionService.update(ingestionSourceId, {
				status: 'active',
				lastSyncFinishedAt: new Date(),
				lastSyncStatusMessage: 'Sync complete. No mailboxes found.',
			});
		}

		// The status will be set back to 'active' by the 'sync-cycle-finished' job
		// once all the mailboxes have been processed.
		logger.info(
			{ ingestionSourceId },
			'Continuous sync job finished dispatching mailbox jobs.'
		);
	} catch (error) {
		logger.error({ err: error, ingestionSourceId }, 'Continuous sync job failed.');
		await IngestionService.update(ingestionSourceId, {
			status: 'error',
			lastSyncFinishedAt: new Date(),
			lastSyncStatusMessage:
				error instanceof Error ? error.message : 'An unknown error occurred during sync.',
		});
		throw error;
	}
};
