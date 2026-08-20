import { Job } from 'bullmq';
import type { ICleanupOrphansJob, ICleanupOrphansResult } from '@open-archiver/types';
import { IndexMaintenanceService } from '../../services/IndexMaintenanceService';
import { logger } from '../../config/logger';

/**
 * Removes search-index documents whose email no longer exists in the database.
 *
 * Runs as a job because the sweep reads every document id in the index, which is far past what an
 * HTTP request should hold open. Dispatched with `attempts: 1` — it deletes, so a retry after a
 * partial run should be a deliberate choice rather than automatic. Re-running is safe and each pass
 * finds strictly fewer, so an interrupted sweep is resumed by triggering it again; the dispatcher
 * clears the finished job record so that stays possible.
 */
export default async function cleanupOrphansProcessor(
	_job: Job<ICleanupOrphansJob>
): Promise<ICleanupOrphansResult> {
	// Built here rather than at module scope, matching the other processors: the worker imports
	// every processor at startup, and a service constructed at import time would connect before
	// the worker is ready to do anything with it.
	const indexMaintenanceService = new IndexMaintenanceService();

	logger.info('Starting orphaned index document cleanup');

	const result = await indexMaintenanceService.cleanupOrphans();

	logger.info(
		{
			sourceBlocksRemoved: result.sourceBlocksRemoved,
			documentsRemoved: result.documentsRemoved,
			scanned: result.scanned,
		},
		'Finished orphaned index document cleanup'
	);

	return result;
}
