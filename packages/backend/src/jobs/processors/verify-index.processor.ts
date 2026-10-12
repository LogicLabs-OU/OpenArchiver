import { Job } from 'bullmq';
import type { IVerifyIndexJob, IVerifyIndexResult } from '@open-archiver/types';
import { IndexMaintenanceService } from '../../services/IndexMaintenanceService';
import { logger } from '../../config/logger';

/**
 * Re-queues emails marked indexed whose document the search index does not have.
 *
 * Runs as a job because it walks every indexed row in the archive. Dispatched with `attempts: 1`,
 * like the orphan sweep; nothing it does needs undoing, and an interrupted run is resumed by
 * triggering it again, which only finds what the first pass did not already queue.
 */
export default async function verifyIndexProcessor(
	_job: Job<IVerifyIndexJob>
): Promise<IVerifyIndexResult> {
	// Built here rather than at module scope, matching the other processors: the worker imports
	// every processor at startup, and a service constructed at import time would connect before
	// the worker is ready to do anything with it.
	const indexMaintenanceService = new IndexMaintenanceService();

	logger.info('Starting search index verification');

	const result = await indexMaintenanceService.verifyIndex();

	logger.info(
		{
			rowsChecked: result.rowsChecked,
			rowsReset: result.rowsReset,
			enqueued: result.enqueued,
			resetBySource: result.resetBySource,
		},
		'Finished search index verification'
	);

	return result;
}
