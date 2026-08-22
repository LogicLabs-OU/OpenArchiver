import { Job } from 'bullmq';
import { IngestionService } from '../../services/IngestionService';
import { IContinuousSyncJob } from '@open-archiver/types';
import { EmailProviderFactory } from '../../services/EmailProviderFactory';
import { enqueueMailboxJobs } from '../helpers/enqueueMailboxJobs';
import { SyncSessionService } from '../../services/SyncSessionService';
import { logger } from '../../config/logger';
import { normalizeEmailAddress } from '../../helpers/emailAddress';
import { ingestionQueue } from '../queues';

export default async (job: Job<IContinuousSyncJob>) => {
	const { ingestionSourceId } = job.data;
	logger.info({ ingestionSourceId }, 'Starting continuous sync job.');

	// Claimed in a single conditional UPDATE rather than read-then-write. Two cycles dispatched in
	// the same tick both used to read 'active' before either wrote 'syncing', so both proceeded and
	// their process-mailbox jobs raced the dedup check and duplicated archived mail. See claimForSync.
	const source = await IngestionService.claimForSync(ingestionSourceId);
	if (!source) {
		logger.warn(
			{ ingestionSourceId },
			'Skipping continuous sync: source is missing, or another cycle already holds it.'
		);
		return;
	}

	const connector = EmailProviderFactory.createConnector(source);

	// One-shot provider-id backfill for Microsoft 365 sources (see the processor). The fixed
	// jobId keeps it to one instance while a run is queued or active; the syncState flag is
	// what ends the re-enqueueing once a run has succeeded. removeOnFail is load-bearing, not
	// hygiene: BullMQ silently drops an add whose jobId matches ANY surviving record, and the
	// queue's defaults retain failed records by count — so without it, one transient failure
	// would park a dead record under this id and every later cycle's add would be dropped
	// against it (the trap claimJobId documents). Removing terminal records instead makes a
	// failed run retry naturally on the next cycle, until the flag stops the loop.
	if (source.provider === 'microsoft_365' && !source.syncState?.providerIdBackfillCompletedAt) {
		await ingestionQueue.add(
			'backfill-provider-ids',
			{ ingestionSourceId },
			{
				jobId: `backfill-provider-ids-${ingestionSourceId}`,
				attempts: 1,
				removeOnComplete: true,
				removeOnFail: true,
			}
		);
	}

	try {
		// Phase 1: Collect user emails (async generator — no full buffering of job descriptors).
		// We need the total count before creating the session so the counter is correct.
		const userEmails: string[] = [];
		for await (const user of connector.listAllUsers()) {
			if (user.primaryEmail) {
				// Normalized here so the mailbox identity is canonical before it is queued.
				userEmails.push(normalizeEmailAddress(user.primaryEmail));
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

		await enqueueMailboxJobs(source.id, userEmails, sessionId);

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
