import { Job } from 'bullmq';
import {
	IProcessMailboxJob,
	ProcessMailboxError,
	ProcessMailboxSkip,
	PendingEmail,
} from '@open-archiver/types';
import { IngestionService } from '../../services/IngestionService';
import { logger } from '../../config/logger';
import { EmailProviderFactory, type IEmailConnector } from '../../services/EmailProviderFactory';
import { StorageService } from '../../services/StorageService';
import { config } from '../../config';
import { indexingQueue, ingestionQueue } from '../queues';
import { SyncSessionService } from '../../services/SyncSessionService';
import { isMailboxUnavailableError } from '../../services/ingestion-connectors/MicrosoftConnector';
import { unlink } from 'fs/promises';

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

	// Both are declared out here so the catch block can still read the connector's skipped-message
	// tally, and so the heartbeat is stopped whichever way the job ends.
	let connector: IEmailConnector | undefined;
	let heartbeatTimer: NodeJS.Timeout | undefined;

	// Declared out here for the same reason as the two above: several emails are archived at once
	// now, so the catch block has to be able to settle whatever was still running when the mailbox
	// failed, and to flush what those tasks buffered.
	const inFlight = new Set<Promise<void>>();

	// Captured before the await, so entries pushed while the enqueue is in flight belong to the
	// next batch instead of being dropped when the array is reset — and put BACK if the enqueue
	// fails, so the ids are still there for the outer catch to retry. Detaching without restoring
	// meant one Redis blip silently stranded up to MEILI_INDEXING_BATCH already-archived emails
	// outside the search index, waiting on a reconcile tick that itself defers under load.
	const flushBatch = async (): Promise<void> => {
		if (emailBatch.length === 0) {
			return;
		}
		const toFlush = emailBatch;
		emailBatch = [];
		try {
			await indexingQueue.add('index-email-batch', { emails: toFlush });
		} catch (err) {
			// Ahead of anything buffered while this was in flight: these were archived first.
			emailBatch = toFlush.concat(emailBatch);
			throw err;
		}
	};

	/**
	 * Records this mailbox's outcome and, if it was the last one, dispatches the finalizer.
	 *
	 * Shared by the failure and the skip paths, which differ only in what they report and must
	 * not differ in anything else: both count towards the session total, and both have to be
	 * able to end the cycle. Its own failure is logged and swallowed for the reason the caller
	 * never re-throws — a second attempt at this job would double-count against the session.
	 */
	const reportMailboxOutcome = async (
		outcome: ProcessMailboxError | ProcessMailboxSkip,
		kind: 'error' | 'skipped'
	): Promise<void> => {
		try {
			const { isLast } = await SyncSessionService.recordMailboxResult(sessionId, outcome);

			if (isLast) {
				logger.info(
					{ ingestionSourceId, sessionId, kind },
					'Last mailbox job completed, dispatching sync-cycle-finished'
				);
				await ingestionQueue.add('sync-cycle-finished', {
					ingestionSourceId,
					sessionId,
					isInitialImport: false,
				});
			}
		} catch (sessionError) {
			logger.error(
				{ err: sessionError, sessionId, kind },
				'Failed to record mailbox result in sync session'
			);
		}
	};

	try {
		const source = await IngestionService.findById(ingestionSourceId);
		if (!source) {
			throw new Error(`Ingestion source with ID ${ingestionSourceId} not found`);
		}

		connector = EmailProviderFactory.createConnector(source);
		const ingestionService = new IngestionService();

		// Resolved once for the whole mailbox rather than per message, and through the same instance
		// memo processEmail uses, so the two paths cannot disagree and the second one costs nothing.
		// The duplicate pre-check below runs before every download, so left unresolved this billed a
		// SELECT for every message the connector merely offered. See resolveGroupSourceIds for the
		// tradeoff this accepts about mid-import merge changes.
		const groupIds = await ingestionService.resolveGroupSourceIds(source);

		// Preserve-original (GoBD) sources dedup byte-identical messages on a content hash as well
		// as on Message-ID, and that check is a check-then-insert like the others. Emails with no
		// Message-ID are exactly the ones that hash-gate exists for, and exactly the ones that would
		// otherwise get a per-message key and run concurrently — so in that mode they all share one
		// key and go one at a time. Read from the root: a merge child stores under its parent's
		// compliance mode.
		const rootSource = source.mergedIntoId
			? await IngestionService.findById(source.mergedIntoId)
			: source;
		const collapseKeylessEmails = Boolean(rootSource?.preserveOriginalFile);

		// A file import archives everything the file holds, drafts included: the operator chose its
		// contents, and a one-shot import cannot accumulate revisions the way a polled mailbox does.
		// The file connectors never set isDraft, so this is inert today — it is here so that adding
		// detection to one of them later cannot quietly start discarding imported mail.
		const isFileImport = IngestionService.returnFileBasedIngestions().includes(source.provider);
		const archiveDrafts = isFileImport || config.ingestion.archiveDrafts;

		// Pre-check for duplicates without fetching full email content.
		// Scoped to this specific mailbox (userEmail) so that different recipients
		// of the same email each get their own archived row — only skipping when
		// THIS mailbox already has the email (re-sync idempotency).
		const checkDuplicate = async (messageId: string, internetMessageId?: string) => {
			return await IngestionService.doesEmailExist(
				messageId,
				ingestionSourceId,
				userEmail,
				groupIds,
				internetMessageId
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

		// On a timer rather than inside the loop below, because the loop body only runs when the
		// connector yields something. Long stretches legitimately yield nothing — a duplicate
		// pre-check streak on re-sync, a message the connector retried and gave up on, an
		// abandoned folder — and a heartbeat that waits for a yield starves in exactly those
		// stretches. cleanStaleSessions() then marks the live import stale after 30 minutes, flips
		// the source to 'error', and the next scheduler tick launches a SECOND concurrent import
		// that races this one. A timer beats for as long as this process is alive and stops when
		// it dies, which is the condition the staleness detector is actually testing for.
		heartbeatTimer = setInterval(() => {
			// heartbeat() swallows its own errors, so this cannot reject unhandled.
			void SyncSessionService.heartbeat(sessionId);
		}, HEARTBEAT_INTERVAL_MS);
		heartbeatTimer.unref();

		// Archiving one email is fetch-then-write, and awaiting it inline meant the connector sat
		// idle for every storage write and DB insert, then the writes sat idle for the next fetch.
		// Several emails are now in flight at once so those overlap. Two invariants make that safe:
		//
		//  - Emails sharing a dedup key run strictly one after another (`keyed`). The dedup gate is a
		//    check-then-insert with no unique index behind it, so the same Message-ID arriving twice
		//    — filed in two folders, a Sent copy — must not be examined concurrently. Such a task
		//    holds its slot while it waits, which is deliberate: it is what stops the loop pulling
		//    an unbounded run of copies of one message into memory ahead of a queue it cannot drain.
		//  - The counters and emailBatch below are only ever touched from these tasks, and
		//    JavaScript runs them on one thread, so they need no locking of their own.
		const keyed = new Map<string, Promise<void>>();

		// A single waiter, resolved by whichever task finishes next. Promise.race over the in-flight
		// set attached a fresh reaction to every unsettled member on every iteration, and those are
		// only released when the member settles — so one task stuck on a half-open socket pinned a
		// reaction per remaining message of the mailbox, in a worker with no heap ceiling.
		let slotFree: (() => void) | null = null;

		for await (const email of connector.fetchEmails(
			userEmail,
			source.syncState,
			checkDuplicate
		)) {
			if (!email) {
				continue;
			}

			messagesSeen++;

			// Unsent drafts from a live mailbox are dropped here, before any storage or database
			// work. Archiving them fails in both directions: a provider that gives every auto-save
			// its own identity fills the archive with revisions of an email that was never sent,
			// while a server that keeps one Message-ID from draft to sent has the draft archived
			// first and the real message then discarded as a duplicate of it (#447).
			//
			// Counted as seen but neither archived nor failed, matching how a deduplicated message
			// is already accounted for. Counting it as a failure would flip the source to 'error'
			// and throw away the run's sync state.
			if (email.isDraft && !archiveDrafts) {
				logger.debug(
					{ ingestionSourceId, userEmail, emailId: email.id, path: email.path },
					'Skipping unsent draft'
				);
				// processEmail owns this cleanup normally, and it is not being called.
				await unlink(email.tempFilePath).catch((err) =>
					logger.warn(
						{ err, tempFilePath: email.tempFilePath },
						'Failed to delete temp email file'
					)
				);
				continue;
			}

			const dedupKey = IngestionService.dedupKeyFor(email, collapseKeylessEmails);
			const prior = keyed.get(dedupKey);

			const task: Promise<void> = (async () => {
				if (prior) {
					await prior;
				}
				try {
					const processedEmail = await ingestionService.processEmail(
						email,
						source,
						storageService,
						userEmail
					);
					if (processedEmail && 'error' in processedEmail) {
						messagesFailed++;
						if (failureSamples.length < MAX_FAILURE_SAMPLES) {
							failureSamples.push(processedEmail.message);
						}
					} else if (processedEmail) {
						messagesArchived++;
						// Buffered only. Flushing happens on the main loop below, because a queue
						// failure is a mailbox-level problem, not this email's: counted here it
						// would mark an email that archived perfectly well as failed, discard the
						// run's sync state over a Redis blip, and let the job finish successfully
						// so BullMQ never retried it.
						emailBatch.push(processedEmail);
					}
				} catch (err) {
					// processEmail reports failures by return value, so reaching here means
					// something escaped it entirely. Counted rather than thrown: a rejected task
					// would reject the slot wait below and with it the rest of the mailbox.
					messagesFailed++;
					if (failureSamples.length < MAX_FAILURE_SAMPLES) {
						failureSamples.push(
							`Email ${email.id}: ${err instanceof Error ? err.message : 'unknown error'}`
						);
					}
					logger.error(
						{ err, ingestionSourceId, userEmail, emailId: email.id },
						'Unhandled error while archiving email'
					);
				}
			})();

			const tracked: Promise<void> = task.finally(() => {
				inFlight.delete(tracked);
				// Only if this task is still the latest for the key — a newer email may already
				// have chained itself behind it.
				if (keyed.get(dedupKey) === tracked) {
					keyed.delete(dedupKey);
				}
				if (slotFree) {
					const release = slotFree;
					slotFree = null;
					release();
				}
			});

			inFlight.add(tracked);
			keyed.set(dedupKey, tracked);

			if (inFlight.size >= config.ingestion.emailConcurrency) {
				await new Promise<void>((resolve) => {
					slotFree = resolve;
				});
			}

			// On the main loop, so a queue failure unwinds to the mailbox-level catch below rather
			// than being blamed on whichever email happened to fill the batch. The batch can
			// overshoot BATCH_SIZE by up to emailConcurrency - 1 while those tasks land; harmless,
			// since a job carries ids and nothing else.
			if (emailBatch.length >= BATCH_SIZE) {
				await flushBatch();
			}
		}

		// Everything after this point reports on the mailbox as a whole, so it must not start until
		// every in-flight email has landed and had its result counted.
		await Promise.all(inFlight);

		await flushBatch();

		// Messages the connector could not fetch and skipped so the rest of the mailbox could
		// finish (#441). Counting them here is what discards this run's sync state, so the next
		// cycle re-attempts them rather than advancing the marker past them and losing them.
		const fetchFailures = connector.getFetchFailures?.();
		if (fetchFailures && fetchFailures.count > 0) {
			messagesSeen += fetchFailures.count;
			messagesFailed += fetchFailures.count;
			for (const sample of fetchFailures.samples) {
				if (failureSamples.length < MAX_FAILURE_SAMPLES) {
					failureSamples.push(sample);
				}
			}
		}

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
		// Emails still being archived when the mailbox failed are given the chance to finish before
		// anything is reported. Left running, their rows would land after this job had already
		// declared itself done, and the ids they buffered would never reach the indexing queue —
		// recoverable via the reconcile pass, but only after a delay, and only by accident.
		await Promise.allSettled(inFlight);

		// Flush whatever those tasks buffered before reporting failure. Guarded, because a mailbox
		// usually fails precisely when Redis is unhealthy — which is exactly when this enqueue
		// fails too, and an escape here would skip recordMailboxResult and re-throw the job,
		// the double-counting retry the contract at the bottom of this block forbids.
		try {
			await flushBatch();
		} catch (flushError) {
			logger.error(
				{ err: flushError, ingestionSourceId, userEmail, buffered: emailBatch.length },
				'Could not enqueue archived emails for indexing; the reconcile pass will recover them'
			);
		}

		// A directory entry with no mailbox is not a failed mailbox. Reported as a skip, the
		// cycle can still finish successfully; reported as an error it kept the source in
		// 'error', which the scheduler retries every tick — forever, since no amount of
		// retrying gives a guest a mailbox (#351). Checked before the error path below so the
		// distinction is made once, on the way out.
		if (isMailboxUnavailableError(error)) {
			logger.info(
				{ ingestionSourceId, userEmail },
				'Skipping mailbox: this account has no mailbox to archive'
			);
			await reportMailboxOutcome(
				{
					skipped: true,
					message: `Skipped ${userEmail}: the account has no mailbox to archive (guest or unlicensed user).`,
				},
				'skipped'
			);
			return;
		}

		logger.error({ err: error, ingestionSourceId, userEmail }, 'Error processing mailbox');
		const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

		// Messages the connector skipped before whatever ended the mailbox. The tally's own abort
		// throw unwinds past the success path that normally reads this, so without it the count
		// and samples gathered up to that point would never reach the report.
		const fetchFailures = connector?.getFetchFailures?.();
		const skipped =
			fetchFailures && fetchFailures.count > 0
				? ` ${fetchFailures.count} message(s) were skipped before this: ${fetchFailures.samples.join('; ')}`
				: '';

		const processMailboxError: ProcessMailboxError = {
			error: true,
			message: `Failed to process mailbox for ${userEmail}: ${errorMessage}.${skipped}`,
		};

		// Report failure to the session — this still counts towards the total
		await reportMailboxOutcome(processMailboxError, 'error');

		// Do not re-throw — a single failed mailbox should not mark the BullMQ job as failed
		// and trigger retries that would double-count against the session counter.
	} finally {
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
		}
	}
};
