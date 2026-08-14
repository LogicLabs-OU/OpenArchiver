import { Job } from 'bullmq';
import {
	IProcessMailboxJob,
	ProcessMailboxError,
	PendingEmail,
	EmailObject,
} from '@open-archiver/types';
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

		const { idCache, groupSourceIds } = await IngestionService.preloadMailboxDuplicateIds(
			ingestionSourceId,
			userEmail
		);
		logger.info(
			{
				ingestionSourceId,
				userEmail,
				preloadedProviderIds: idCache.mailboxProviderIds.size,
				preloadedRfcIds: idCache.mailboxRfcIds.size,
			},
			'Pre-loaded per-mailbox IDs for duplicate checking'
		);

		const checkDuplicate = async (messageId: string) => {
			return IngestionService.isMailboxDuplicate(messageId, idCache);
		};

		const checkGroupHasMessageId = (rfcMessageId: string) => {
			return IngestionService.groupHasRfcMessageId(rfcMessageId, groupSourceIds, idCache);
		};

		let messagesSeen = 0;
		let messagesArchived = 0;
		let messagesFailed = 0;
		const failureSamples: string[] = [];
		const MAX_FAILURE_SAMPLES = 5;

		const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
		let lastHeartbeatAt = Date.now();

		const processOne = async (email: EmailObject) => {
			return ingestionService.processEmail(
				email,
				source,
				storageService,
				userEmail,
				false,
				groupSourceIds,
				idCache
			);
		};

		for await (const email of connector.fetchEmails(
			userEmail,
			source.syncState,
			checkDuplicate,
			checkGroupHasMessageId,
			(state) => SyncSessionService.mergeSourceSyncState(ingestionSourceId, state)
		)) {
			if (email) {
				messagesSeen++;
				let processedEmail = await processOne(email);

				if (processedEmail === 'needs_raw') {
					if (!connector.fetchRawEmail) {
						messagesFailed++;
						if (failureSamples.length < MAX_FAILURE_SAMPLES) {
							failureSamples.push(
								`Email ${email.id}: METADATA-only miss and no RAW fallback`
							);
						}
					} else {
						const rawEmail = await connector.fetchRawEmail(userEmail, email.id);
						if (!rawEmail) {
							messagesFailed++;
							if (failureSamples.length < MAX_FAILURE_SAMPLES) {
								failureSamples.push(`Email ${email.id}: RAW fallback empty`);
							}
						} else {
							processedEmail = await processOne(rawEmail);
							if (processedEmail === 'needs_raw') {
								messagesFailed++;
								if (failureSamples.length < MAX_FAILURE_SAMPLES) {
									failureSamples.push(
										`Email ${email.id}: RAW fallback still needs_raw`
									);
								}
								processedEmail = null;
							}
						}
					}
				}

				if (processedEmail && typeof processedEmail === 'object' && 'error' in processedEmail) {
					messagesFailed++;
					if (failureSamples.length < MAX_FAILURE_SAMPLES) {
						failureSamples.push(processedEmail.message);
					}
				} else if (processedEmail && processedEmail !== 'needs_raw') {
					messagesArchived++;
					emailBatch.push(processedEmail);
					if (emailBatch.length >= BATCH_SIZE) {
						await indexingQueue.add('index-email-batch', { emails: emailBatch });
						emailBatch = [];
					}
				}
			}
			if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
				await SyncSessionService.heartbeat(sessionId);
				lastHeartbeatAt = Date.now();
			}
		}

		if (emailBatch.length > 0) {
			await indexingQueue.add('index-email-batch', { emails: emailBatch });
			emailBatch = [];
		}

		const newSyncState = connector.getUpdatedSyncState(userEmail);
		const heap = process.memoryUsage();
		logger.warn(
			{
				ingestionSourceId,
				userEmail,
				messagesSeen,
				messagesArchived,
				messagesFailed,
				heapUsedMb: Math.round(heap.heapUsed / 1024 / 1024),
				rssMb: Math.round(heap.rss / 1024 / 1024),
			},
			`Finished processing mailbox for user`
		);

		const { isLast } = await SyncSessionService.recordMailboxResult(
			sessionId,
			messagesFailed > 0
				? {
						error: true,
						message: `${userEmail}: ${messagesFailed} of ${messagesSeen} messages failed to archive. First errors: ${failureSamples.join('; ')}`,
					}
				: newSyncState
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
	}
};
