import { Job } from 'bullmq';
import { IngestionService } from '../../services/IngestionService';
import { logger } from '../../config/logger';
import {
	SyncState,
	ProcessMailboxError,
	IngestionStatus,
	IngestionProvider,
} from '@open-archiver/types';
import { db } from '../../database';
import { ingestionSources } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { deepmerge } from 'deepmerge-ts';

interface ISyncCycleFinishedJob {
	ingestionSourceId: string;
	userCount?: number; // Optional, as it's only relevant for the initial import
	isInitialImport: boolean;
}

/**
 * This processor runs after all 'process-mailbox' jobs for a sync cycle have completed.
 * It is responsible for aggregating the results and finalizing the sync status.
 * It inspects the return values of all child jobs to identify successes and failures.
 *
 * If any child jobs returned an error object, this processor will:
 * 1. Mark the overall ingestion status as 'error'.
 * 2. Aggregate the detailed error messages from all failed jobs.
 * 3. Save the sync state from any jobs that *did* succeed, preserving partial progress.
 *
 * If all child jobs succeeded, it marks the ingestion as 'active' and saves the final
 * aggregated sync state from all children.
 *
 */
export default async (job: Job<ISyncCycleFinishedJob, any, string>) => {
	const { ingestionSourceId, userCount, isInitialImport } = job.data;
	logger.info(
		{ ingestionSourceId, userCount, isInitialImport },
		'Sync cycle finished job started'
	);

	try {
		const childrenValues = await job.getChildrenValues<SyncState | ProcessMailboxError>();
		const allChildJobs = Object.values(childrenValues);
		// if data has error property, it is a failed job
		const failedJobs = allChildJobs.filter(
			(v) => v && (v as any).error
		) as ProcessMailboxError[];
		// if data doesn't have error property, it is a successful job with SyncState
		const successfulJobs = allChildJobs.filter((v) => !v || !(v as any).error) as SyncState[];

		const finalSyncState = deepmerge(
			...successfulJobs.filter((s) => s && Object.keys(s).length > 0)
		) as SyncState;

		const source = await IngestionService.findById(ingestionSourceId);
		let status: IngestionStatus = 'active';
		const fileBasedIngestions = IngestionService.returnFileBasedIngestions();

		if (fileBasedIngestions.includes(source.provider)) {
			status = 'imported';
		}
		let message: string;

		// Check for a specific rate-limit message from the successful jobs
		const rateLimitMessage = successfulJobs.find(
			(j) => j.statusMessage && j.statusMessage.includes('rate limit')
		)?.statusMessage;

		if (failedJobs.length > 0) {
			status = 'error';
			const errorMessages = failedJobs.map((j) => j.message).join('\n');
			message = `Sync cycle completed with ${failedJobs.length} error(s):\n${errorMessages}`;
			logger.error(
				{ ingestionSourceId, errors: errorMessages },
				'Sync cycle finished with errors.'
			);
		} else if (rateLimitMessage) {
			message = rateLimitMessage;
			logger.warn({ ingestionSourceId, message }, 'Sync cycle paused due to rate limiting.');
		} else {
			message = 'Continuous sync cycle finished successfully.';
			if (isInitialImport) {
				message = `Initial import finished for ${userCount} mailboxes.`;
			}
			logger.info({ ingestionSourceId }, 'Successfully updated status and final sync state.');
		}

		await db
			.update(ingestionSources)
			.set({
				status,
				lastSyncFinishedAt: new Date(),
				lastSyncStatusMessage: message,
				syncState: finalSyncState,
			})
			.where(eq(ingestionSources.id, ingestionSourceId));
	} catch (error) {
		logger.error(
			{ err: error, ingestionSourceId },
			'An unexpected error occurred while finalizing the sync cycle.'
		);
		await IngestionService.update(ingestionSourceId, {
			status: 'error',
			lastSyncFinishedAt: new Date(),
			lastSyncStatusMessage: 'An unexpected error occurred while finalizing the sync cycle.',
		});
	}
};
