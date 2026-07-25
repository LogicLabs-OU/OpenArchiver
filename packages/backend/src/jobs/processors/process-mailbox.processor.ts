import { Job } from 'bullmq';
import {
	IProcessMailboxJob,
	ProcessMailboxError,
	PendingEmail,
	ProcessEmailError,
} from '@open-archiver/types';
import { IngestionService } from '../../services/IngestionService';
import { logger } from '../../config/logger';
import { EmailProviderFactory } from '../../services/EmailProviderFactory';
import { StorageService } from '../../services/StorageService';
import { config } from '../../config';
import { indexingQueue, ingestionQueue } from '../queues';
import { SyncSessionService } from '../../services/SyncSessionService';
import { Semaphore } from '../../helpers/semaphore';

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

		// Resolve the merge-group source IDs ONCE per mailbox job. This value is
		// stable for the whole run, so passing it into the per-email duplicate
		// check and processEmail avoids re-running findGroupSourceIds (a DB query
		// + credential decrypt + children query) on every single message.
		const groupIds = await IngestionService.findGroupSourceIds(ingestionSourceId);

		// Pre-check for duplicates without fetching full email content.
		// Scoped to this specific mailbox (userEmail) so that different recipients
		// of the same email each get their own archived row — only skipping when
		// THIS mailbox already has the email (re-sync idempotency).
		const checkDuplicate = async (messageId: string) => {
			return await IngestionService.doesEmailExist(
				messageId,
				ingestionSourceId,
				userEmail,
				groupIds
			);
		};

		// Per-message accounting: processEmail returns a ProcessEmailError object on
		// genuine failures (parse/storage/DB) and null only for dedup skips. Failures
		// must count towards the mailbox result — treating them as skips let imports
		// drop messages while still reporting success (#403).
		let messagesSeen = 0;
		let messagesArchived = 0;
		let messagesFailed = 0;
		const failureSamples: string[] = [];
		const MAX_FAILURE_SAMPLES = 5;

		// Must stay well under cleanStaleSessions()'s 30-minute inactivity threshold.
		const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
		let lastHeartbeatAt = Date.now();

		// Process emails with bounded concurrency so per-email DB + object-storage
		// latency overlaps instead of running strictly one-at-a-time (the batched
		// IMAP fetch already removed the per-message network round-trip). The IMAP
		// generator is still pulled sequentially — async generators are not safe to
		// iterate concurrently — and each yielded email is dispatched to a pool
		// capped at CONCURRENCY. Shared counters and emailBatch are only mutated
		// from the settled callbacks below, which run one at a time on JS's single
		// thread, so no locking is needed.
		//
		// Caveat: two DISTINCT new emails that share a Message-ID and land in the
		// same concurrency window can both pass the dedup gates before either
		// inserts (there is no unique constraint on message_id_header, only an
		// index). This is rare — Pass 1 already filters already-archived dupes, so
		// only brand-new messages reach here — and CONCURRENCY=1 restores the old
		// strictly-serial behavior if it ever matters.
		const CONCURRENCY = config.ingestion.emailConcurrency;
		const sem = new Semaphore(CONCURRENCY);

		const flushBatch = async () => {
			if (emailBatch.length === 0) return;
			// Capture + reset synchronously (no await between) so a concurrent
			// completion can't push into a batch that is mid-flush.
			const toFlush = emailBatch;
			emailBatch = [];
			await indexingQueue.add('index-email-batch', { emails: toFlush });
		};

		const handleResult = async (
			result: PendingEmail | ProcessEmailError | null
		): Promise<void> => {
			if (result && 'error' in result) {
				messagesFailed++;
				if (failureSamples.length < MAX_FAILURE_SAMPLES) {
					failureSamples.push(result.message);
				}
			} else if (result) {
				messagesArchived++;
				emailBatch.push(result);
				if (emailBatch.length >= BATCH_SIZE) {
					await flushBatch();
				}
			}
		};

		for await (const email of connector.fetchEmails(
			userEmail,
			source.syncState,
			checkDuplicate
		)) {
			if (email) {
				messagesSeen++;
				await sem.acquire();
				// Detached: the pool bounds how many run at once; we drain below.
				void (async () => {
					try {
						const result = await ingestionService.processEmail(
							email,
							source,
							storageService,
							userEmail,
							false,
							groupIds
						);
						await handleResult(result);
					} catch (err) {
						// processEmail is designed to RETURN a ProcessEmailError rather
						// than throw; treat an unexpected throw as a per-message failure
						// (count it, don't drop it silently — #403) instead of aborting
						// the whole mailbox.
						messagesFailed++;
						if (failureSamples.length < MAX_FAILURE_SAMPLES) {
							failureSamples.push(
								`${email.id}: ${err instanceof Error ? err.message : 'unknown error'}`
							);
						}
					} finally {
						sem.release();
					}
				})();
			}
			// Heartbeat on wall-clock time, unconditionally. A single large mailbox can
			// take hours, and long stretches legitimately archive nothing (dedup-skip
			// streaks on re-sync, slow folders with large attachments), so a heartbeat
			// tied to batch flushes starves in exactly those stretches —
			// cleanStaleSessions() then marks the live import stale after 30 minutes,
			// flips the source to 'error', and the next scheduler tick launches a SECOND
			// concurrent import that races this one and duplicates the archive.
			if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
				await SyncSessionService.heartbeat(sessionId);
				lastHeartbeatAt = Date.now();
			}
		}

		// Drain: acquiring every permit is only possible once all in-flight
		// processEmail calls have released theirs.
		for (let i = 0; i < CONCURRENCY; i++) {
			await sem.acquire();
		}

		await flushBatch();

		const newSyncState = connector.getUpdatedSyncState(userEmail);
		logger.info(
			{ ingestionSourceId, userEmail, messagesSeen, messagesArchived, messagesFailed },
			`Finished processing mailbox for user`
		);

		// Report the result to the session and check if this is the last job.
		// Any per-message failure marks the mailbox as failed so the source ends the
		// cycle in 'error' status with the counts visible, instead of a silent success.
		// The sync state for this run is discarded on failure; the next sync re-scans
		// and dedup skips what was already archived.
		const { isLast, totalFailed } = await SyncSessionService.recordMailboxResult(
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
