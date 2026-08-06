import { Job } from 'bullmq';
import { IngestionService } from '../../services/IngestionService';
import { IContinuousSyncJob } from '@open-archiver/types';
import { EmailProviderFactory } from '../../services/EmailProviderFactory';
import { ingestionQueue } from '../queues';
import { SyncSessionService } from '../../services/SyncSessionService';
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
		// Phase 1: Collect user emails (async generator — no full buffering of job descriptors).
		// We need the total count before creating the session so the counter is correct.
		const userEmails: string[] = [];
		for await (const user of connector.listAllUsers()) {
			if (user.primaryEmail) {
				userEmails.push(user.primaryEmail);
			}
		}

		if (userEmails.length === 0) {
			logger.info(
				{ ingestionSourceId },
				'No users found during continuous sync, marking active.'
			);
			await IngestionService.update(ingestionSourceId, {
				status: 'active',
				lastSyncFinishedAt: new Date(),
				lastSyncStatusMessage: 'Continuous sync complete. No users found.',
			});
			return;
		}

		// Phase 2: Create a session BEFORE dispatching any jobs.
		const sessionId = await SyncSessionService.create(
			ingestionSourceId,
			userEmails.length,
			false
		);

		logger.info(
			{ ingestionSourceId, userCount: userEmails.length, sessionId },
			'Dispatching process-mailbox jobs for continuous sync'
		);

		// Phase 3: Enqueue individual process-mailbox jobs one at a time.
		// No FlowProducer — each job carries the sessionId for DB-based coordination.
		for (const userEmail of userEmails) {
			await ingestionQueue.add('process-mailbox', {
				ingestionSourceId: source.id,
				userEmail,
				sessionId,
			});
		}

		// The status will be set back to 'active' by the 'sync-cycle-finished' job
		// once all the mailboxes have been processed.
		logger.info(
			{ ingestionSourceId, sessionId },
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
