import { Job } from 'bullmq';
import { IngestionService } from '../../services/IngestionService';
import { SyncSessionService } from '../../services/SyncSessionService';
import { logger } from '../../config/logger';
import { IngestionStatus } from '@open-archiver/types';

interface ISyncCycleFinishedJob {
	ingestionSourceId: string;
	sessionId: string;
	isInitialImport: boolean;
}

/**
 * Finalizes a sync cycle after all process-mailbox jobs have completed.
 *
 * This processor no longer uses BullMQ's job.getChildrenValues() or deepmerge.
 * Instead, it reads the aggregated results from the sync_sessions table in PostgreSQL,
 * where each process-mailbox job has already atomically recorded its outcome and
 * incrementally merged its SyncState into ingestion_sources.sync_state.
 */
export default async (job: Job<ISyncCycleFinishedJob>) => {
	const { ingestionSourceId, sessionId, isInitialImport } = job.data;

	logger.info(
		{ ingestionSourceId, sessionId, isInitialImport },
		'Sync cycle finished job started'
	);

	try {
		const session = await SyncSessionService.findById(sessionId);

		let status: IngestionStatus = 'active';
		let message: string;

		const fileBasedIngestions = IngestionService.returnFileBasedIngestions();
		const source = await IngestionService.findById(ingestionSourceId);

		if (fileBasedIngestions.includes(source.provider)) {
			status = 'imported';
		}

		// The message array holds notes, of which errors are one kind — a mailbox that was
		// skipped for having nothing to archive also leaves one. Only failedMailboxes decides
		// whether the cycle failed, so a tenant whose sole "problem" is guest accounts settles
		// in 'active' instead of being retried every tick forever (#351).
		const notes = session.errorMessages.join('\n');

		if (session.failedMailboxes > 0) {
			status = 'error';
			message = `Sync cycle completed with ${session.failedMailboxes} error(s):\n${notes}`;
			logger.error(
				{ ingestionSourceId, sessionId, errors: notes },
				'Sync cycle finished with errors.'
			);
		} else {
			message = isInitialImport
				? `Initial import finished for ${session.completedMailboxes} mailboxes.`
				: 'Continuous sync cycle finished successfully.';
			// Named rather than merely counted: the operator needs to see WHICH accounts were
			// passed over, or a mailbox missing from the archive by mistake looks identical to
			// one skipped on purpose.
			if (notes) {
				message += `\n${notes}`;
			}
			logger.info({ ingestionSourceId, sessionId }, 'Sync cycle finished successfully.');
		}

		// syncState was already merged incrementally by each process-mailbox job via
		// SyncSessionService.recordMailboxResult() — no deepmerge needed here.
		await IngestionService.update(ingestionSourceId, {
			status: source.status === 'paused' ? 'paused' : status, // Don't override paused status
			lastSyncFinishedAt: new Date(),
			lastSyncStatusMessage: message,
		});

		// Clean up the session row
		await SyncSessionService.finalize(sessionId);

		logger.info({ ingestionSourceId, sessionId, status }, 'Sync cycle finalized');
	} catch (error) {
		logger.error(
			{ err: error, ingestionSourceId, sessionId },
			'An unexpected error occurred while finalizing the sync cycle.'
		);
		await IngestionService.update(ingestionSourceId, {
			status: 'error',
			lastSyncFinishedAt: new Date(),
			lastSyncStatusMessage: 'An unexpected error occurred while finalizing the sync cycle.',
		});
		// The session is dropped on this path too. 'error' is a status the scheduler picks up again,
		// so the cycle is already accounted for; leaving the row behind would only make the stale
		// sweep re-dispatch this same failing finalizer every threshold period.
		await SyncSessionService.finalize(sessionId).catch((err) =>
			logger.warn({ err, sessionId }, 'Failed to delete session after a failed finalization')
		);
	}
};
