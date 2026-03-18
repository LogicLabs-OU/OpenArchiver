import { Job } from 'bullmq';
import { IProcessMailboxJob, ProcessMailboxError, PendingEmail } from '@open-archiver/types';
import { IngestionService } from '../../services/IngestionService';
import { logger } from '../../config/logger';
import { EmailProviderFactory } from '../../services/EmailProviderFactory';
import { StorageService } from '../../services/StorageService';
import { config } from '../../config';
import { indexingQueue, ingestionQueue } from '../queues';
import { SyncSessionService } from '../../services/SyncSessionService';

/**
 * Handles ingestion of emails for a single user's mailbox.
 *
 * On completion, it reports its result to SyncSessionService using an atomic DB counter.
 * If this is the last mailbox job in the session, it dispatches the 'sync-cycle-finished' job.
 * This replaces the BullMQ FlowProducer parent/child pattern, avoiding the memory and Redis
 * overhead of loading all children's return values at once.
 */
export const processMailboxProcessor = async (job: Job<IProcessMailboxJob>) => {
	const { ingestionSourceId, userEmail, sessionId } = job.data;
	const BATCH_SIZE: number = config.meili.indexingBatchSize;
	let emailBatch: PendingEmail[] = [];

	logger.info({ ingestionSourceId, userEmail, sessionId }, `Processing mailbox for user`);

	const storageService = new StorageService();

	try {
		const source = await IngestionService.findById(ingestionSourceId);
		if (!source) {
			throw new Error(`Ingestion source with ID ${ingestionSourceId} not found`);
		}

		const connector = EmailProviderFactory.createConnector(source);
		const ingestionService = new IngestionService();

		// Pre-check for duplicates without fetching full email content
		const checkDuplicate = async (messageId: string) => {
			return await IngestionService.doesEmailExist(messageId, ingestionSourceId);
		};

		for await (const email of connector.fetchEmails(
			userEmail,
			source.syncState,
			checkDuplicate
		)) {
			if (email) {
				const processedEmail = await ingestionService.processEmail(
					email,
					source,
					storageService,
					userEmail
				);
				if (processedEmail) {
					emailBatch.push(processedEmail);
					if (emailBatch.length >= BATCH_SIZE) {
						await indexingQueue.add('index-email-batch', { emails: emailBatch });
						emailBatch = [];
						// Heartbeat: a single large mailbox can take hours to process.
						// Without this, cleanStaleSessions() would see no activity on the
						// session and incorrectly mark it as stale after 30 minutes.
						// We piggyback on the existing batch flush cadence — no extra DB
						// writes beyond what we'd do anyway.
						await SyncSessionService.heartbeat(sessionId);
					}
				}
			}
		}

		if (emailBatch.length > 0) {
			await indexingQueue.add('index-email-batch', { emails: emailBatch });
			emailBatch = [];
		}

		const newSyncState = connector.getUpdatedSyncState(userEmail);
		logger.info({ ingestionSourceId, userEmail }, `Finished processing mailbox for user`);

		// Report success to the session and check if this is the last job
		const { isLast, totalFailed } = await SyncSessionService.recordMailboxResult(
			sessionId,
			newSyncState
		);

		if (isLast) {
			logger.info(
				{ ingestionSourceId, sessionId },
				'Last mailbox job completed, dispatching sync-cycle-finished'
			);
			await ingestionQueue.add('sync-cycle-finished', {
				ingestionSourceId,
				sessionId,
				isInitialImport: false,
			});
		}
	} catch (error) {
		// Flush any buffered emails before reporting failure
		if (emailBatch.length > 0) {
			await indexingQueue.add('index-email-batch', { emails: emailBatch });
			emailBatch = [];
		}

		logger.error({ err: error, ingestionSourceId, userEmail }, 'Error processing mailbox');
		const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
		const processMailboxError: ProcessMailboxError = {
			error: true,
			message: `Failed to process mailbox for ${userEmail}: ${errorMessage}`,
		};

		// Report failure to the session — this still counts towards the total
		try {
			const { isLast } = await SyncSessionService.recordMailboxResult(
				sessionId,
				processMailboxError
			);

			if (isLast) {
				logger.info(
					{ ingestionSourceId, sessionId },
					'Last mailbox job (with error) completed, dispatching sync-cycle-finished'
				);
				await ingestionQueue.add('sync-cycle-finished', {
					ingestionSourceId,
					sessionId,
					isInitialImport: false,
				});
			}
		} catch (sessionError) {
			logger.error(
				{ err: sessionError, sessionId },
				'Failed to record mailbox error in sync session'
			);
		}

		// Do not re-throw — a single failed mailbox should not mark the BullMQ job as failed
		// and trigger retries that would double-count against the session counter.
	}
};
