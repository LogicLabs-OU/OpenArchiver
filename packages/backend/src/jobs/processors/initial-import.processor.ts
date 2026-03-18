import { Job } from 'bullmq';
import { IngestionService } from '../../services/IngestionService';
import { IInitialImportJob, IngestionStatus } from '@open-archiver/types';
import { EmailProviderFactory } from '../../services/EmailProviderFactory';
import { ingestionQueue } from '../queues';
import { SyncSessionService } from '../../services/SyncSessionService';
import { logger } from '../../config/logger';

export default async (job: Job<IInitialImportJob>) => {
	const { ingestionSourceId } = job.data;
	logger.info({ ingestionSourceId }, 'Starting initial import master job');

	try {
		const source = await IngestionService.findById(ingestionSourceId);
		if (!source) {
			throw new Error(`Ingestion source with ID ${ingestionSourceId} not found`);
		}

		await IngestionService.update(ingestionSourceId, {
			status: 'importing',
			lastSyncStatusMessage: 'Starting initial import...',
		});

		const connector = EmailProviderFactory.createConnector(source);

		// Phase 1: Collect user emails from the provider (async generator — no full buffering
		// of FlowChildJob objects). Email strings are tiny (~30 bytes each) compared to the
		// old FlowChildJob descriptors (~500 bytes each), and we need the count before we can
		// create the session.
		const userEmails: string[] = [];
		for await (const user of connector.listAllUsers()) {
			if (user.primaryEmail) {
				userEmails.push(user.primaryEmail);
			}
		}

		if (userEmails.length === 0) {
			const fileBasedIngestions = IngestionService.returnFileBasedIngestions();
			const finalStatus: IngestionStatus = fileBasedIngestions.includes(source.provider)
				? 'imported'
				: 'active';
			await IngestionService.update(ingestionSourceId, {
				status: finalStatus,
				lastSyncFinishedAt: new Date(),
				lastSyncStatusMessage: 'Initial import complete. No users found.',
			});
			logger.info({ ingestionSourceId }, 'No users found, initial import complete');
			return;
		}

		// Phase 2: Create a session BEFORE dispatching any jobs to avoid a race condition
		// where a process-mailbox job finishes before the session's totalMailboxes is set.
		const sessionId = await SyncSessionService.create(
			ingestionSourceId,
			userEmails.length,
			true
		);

		logger.info(
			{ ingestionSourceId, userCount: userEmails.length, sessionId },
			'Dispatching process-mailbox jobs for initial import'
		);

		// Phase 3: Enqueue individual process-mailbox jobs one at a time.
		// No FlowProducer, no large atomic Redis write — jobs are enqueued in a loop.
		for (const userEmail of userEmails) {
			await ingestionQueue.add('process-mailbox', {
				ingestionSourceId,
				userEmail,
				sessionId,
			});
		}

		logger.info({ ingestionSourceId, sessionId }, 'Finished dispatching initial import jobs');
	} catch (error) {
		logger.error({ err: error, ingestionSourceId }, 'Error in initial import master job');
		await IngestionService.update(ingestionSourceId, {
			status: 'error',
			lastSyncStatusMessage: `Initial import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
		});
		throw error;
	}
};
