import { Job } from 'bullmq';
import { IngestionService } from '../../services/IngestionService';
import { IInitialImportJob, IngestionStatus, MailboxUser } from '@open-archiver/types';
import { EmailProviderFactory } from '../../services/EmailProviderFactory';
import { enqueueMailboxJobs } from '../helpers/enqueueMailboxJobs';
import { SyncSessionService } from '../../services/SyncSessionService';
import { logger } from '../../config/logger';
import { describeError } from '../../helpers/describeError';
import { normalizeEmailAddress } from '../../helpers/emailAddress';
import { MailboxRegistryService } from '../../services/MailboxRegistryService';

export default async (job: Job<IInitialImportJob>) => {
	const { ingestionSourceId } = job.data;
	logger.info({ ingestionSourceId }, 'Starting initial import master job');

	try {
		// One conditional UPDATE, for the same reason continuous-sync uses one: a second import
		// dispatched while this one is in flight would create its own session and race the dedup
		// check. See IngestionService.claimForImport.
		const source = await IngestionService.claimForImport(ingestionSourceId);
		if (!source) {
			logger.warn(
				{ ingestionSourceId },
				'Skipping initial import: source is missing, or an import or sync is already running.'
			);
			return;
		}

		const connector = EmailProviderFactory.createConnector(source);

		// Phase 1: Collect user emails from the provider (async generator — no full buffering
		// of FlowChildJob objects). Email strings are tiny (~30 bytes each) compared to the
		// old FlowChildJob descriptors (~500 bytes each), and we need the count before we can
		// create the session.
		const userEmails: string[] = [];
		const listedUsers: MailboxUser[] = [];
		for await (const user of connector.listAllUsers()) {
			if (user.primaryEmail) {
				// Normalized here so the mailbox identity is canonical before it is queued.
				userEmails.push(normalizeEmailAddress(user.primaryEmail));
				listedUsers.push(user);
			}
		}

		// Recorded before any mailbox job runs, so a mailbox is known to seat accounting before
		// its first message is archived. Never allowed to fail the import: what the directory says
		// about a mailbox is useful, but it is not what the customer asked this job to do.
		try {
			await MailboxRegistryService.upsertFromDirectory(source, listedUsers, connector);
		} catch (error) {
			logger.error(
				{ err: error, ingestionSourceId },
				'Could not record directory mailboxes; seat accounting will recover them at the next reconciliation'
			);
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

		await enqueueMailboxJobs(ingestionSourceId, userEmails, sessionId);

		logger.info({ ingestionSourceId, sessionId }, 'Finished dispatching initial import jobs');
	} catch (error) {
		logger.error({ err: error, ingestionSourceId }, 'Error in initial import master job');
		await IngestionService.update(ingestionSourceId, {
			status: 'error',
			lastSyncStatusMessage: `Initial import failed: ${describeError(error)}`,
		});
		throw error;
	}
};
