import { Job } from 'bullmq';
import type { ICleanupDuplicatesJob, ICleanupDuplicatesResult } from '@open-archiver/types';
import { ArchiveMaintenanceService } from '../../services/ArchiveMaintenanceService';
import { UserService } from '../../services/UserService';
import { logger } from '../../config/logger';

/**
 * Removes the surplus copies left behind when two sync cycles archived the same message.
 *
 * Runs as a job because each removal is a storage check, a Meilisearch task it must see finish, and
 * a row delete — far past what an HTTP request should hold open on an archive with thousands of
 * them. Dispatched with `attempts: 1`: it deletes, so a retry after a partial run should be a
 * deliberate choice. Re-running is safe and each pass finds strictly fewer.
 */
export default async function cleanupDuplicatesProcessor(
	job: Job<ICleanupDuplicatesJob>
): Promise<ICleanupDuplicatesResult> {
	const { ingestionSourceId, actorId, actorIp } = job.data;

	// Re-read rather than carried in the payload, so the audit entries every removal writes name a
	// user that still exists and still holds the role they did. A user deleted between the request
	// and the run fails the job rather than attributing deletions to nobody.
	const actor = await new UserService().findById(actorId);
	if (!actor) {
		throw new Error(
			`Cannot run duplicate cleanup: the user who triggered it (${actorId}) no longer exists.`
		);
	}

	logger.info({ ingestionSourceId, actorId }, 'Starting duplicate email cleanup');

	const result = await ArchiveMaintenanceService.cleanupDuplicates(
		actor,
		actorIp,
		ingestionSourceId
	);

	logger.info(
		{
			ingestionSourceId,
			examined: result.examined,
			removed: result.removed,
			skippedProtected: result.skippedProtected,
			skippedContentDiffers: result.skippedContentDiffers,
			skippedFailed: result.skippedFailed,
		},
		'Finished duplicate email cleanup'
	);

	return result;
}
