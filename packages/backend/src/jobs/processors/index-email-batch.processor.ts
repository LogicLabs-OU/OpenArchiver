import { Job } from 'bullmq';
import { IndexingService } from '../../services/IndexingService';
import { SearchService } from '../../services/SearchService';
import { StorageService } from '../../services/StorageService';
import { DatabaseService } from '../../services/DatabaseService';
import { PendingEmail } from '@open-archiver/types';
import { logger } from '../../config/logger';

let indexingService: IndexingService | null = null;

/**
 * Built on first job rather than at import, so a constructor that throws — StorageService rejecting
 * an unrecognised provider type, for instance — becomes an ordinary failed job that BullMQ retries
 * and the jobs admin page shows with its reason, instead of killing the process during module load,
 * before the worker's error handlers exist. Every other processor already builds its services inside
 * the handler.
 *
 * This covers constructors only. Module-scope failures further down the import chain still take the
 * process down at load: config/storage.ts throws on an unrecognised STORAGE_TYPE and database/index.ts
 * needs DATABASE_URL, both evaluated on import. Hoisting means no handler in this file can catch
 * those; they are a startup contract, and the restart loop plus the logged reason is the answer there.
 */
const getIndexingService = (): IndexingService => {
	if (!indexingService) {
		indexingService = new IndexingService(
			new DatabaseService(),
			new SearchService(),
			new StorageService()
		);
	}
	return indexingService;
};

export default async function (job: Job<{ emails: PendingEmail[] }>) {
	const { emails } = job.data;
	logger.info(`Indexing email batch with ${emails.length} emails`);
	await getIndexingService().indexEmailBatch(emails);
}
