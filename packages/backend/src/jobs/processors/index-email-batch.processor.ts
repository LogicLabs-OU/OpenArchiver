import { Job } from 'bullmq';
import { IndexingService } from '../../services/IndexingService';
import { SearchService } from '../../services/SearchService';
import { StorageService } from '../../services/StorageService';
import { DatabaseService } from '../../services/DatabaseService';
import { PendingEmail } from '@open-archiver/types';

const searchService = new SearchService();
const storageService = new StorageService();
const databaseService = new DatabaseService();
const indexingService = new IndexingService(databaseService, searchService, storageService);

export default async function (job: Job<{ emails: PendingEmail[] }>) {
	const { emails } = job.data;
	console.log(`Indexing email batch with ${emails.length} emails`);
	await indexingService.indexEmailBatch(emails);
}
