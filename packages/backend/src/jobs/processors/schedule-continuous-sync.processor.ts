import { Job } from 'bullmq';
import { db } from '../../database';
import { ingestionSources } from '../../database/schema';
import { or, eq } from 'drizzle-orm';
import { ingestionQueue } from '../queues';
import { SyncSessionService } from '../../services/SyncSessionService';
import { logger } from '../../config/logger';

export default async (job: Job) => {
	logger.info({}, 'Scheduler running: checking for stale sessions and active sources to sync.');

	// Step 1: Clean up any stale sync sessions from previous crashed runs.
	// A session is stale when lastActivityAt hasn't been updated in 30 minutes —
	// meaning no process-mailbox job has reported back, indicating the worker crashed
	// after creating the session but before all jobs were enqueued.
	// This sets the associated ingestion source to 'error' so Step 2 picks it up.
	try {
		await SyncSessionService.cleanStaleSessions();
	} catch (error) {
		// Log but don't abort — stale session cleanup is best-effort
		logger.error({ err: error }, 'Error during stale session cleanup in scheduler');
	}

	// Step 2: Find all sources with status 'active' or 'error' for continuous syncing.
	// Sources previously stuck in 'importing'/'syncing' due to a crash will now appear
	// as 'error' (set by cleanStaleSessions above) and will be picked up here for retry.
	const sourcesToSync = await db
		.select({ id: ingestionSources.id })
		.from(ingestionSources)
		.where(or(eq(ingestionSources.status, 'active'), eq(ingestionSources.status, 'error')));

	logger.info({ count: sourcesToSync.length }, 'Dispatching continuous-sync jobs for sources');

	for (const source of sourcesToSync) {
		// The status field on the ingestion source prevents duplicate concurrent syncs.
		await ingestionQueue.add('continuous-sync', { ingestionSourceId: source.id });
	}
};
