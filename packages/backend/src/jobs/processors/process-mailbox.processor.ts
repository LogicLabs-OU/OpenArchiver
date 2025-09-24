import { Job } from 'bullmq';
import {
	IProcessMailboxJob,
	SyncState,
	ProcessMailboxError,
	PendingEmail,
} from '@open-archiver/types';
import { IngestionService } from '../../services/IngestionService';
import { logger } from '../../config/logger';
import { EmailProviderFactory } from '../../services/EmailProviderFactory';
import { StorageService } from '../../services/StorageService';
import { IndexingService } from '../../services/IndexingService';
import { SearchService } from '../../services/SearchService';
import { DatabaseService } from '../../services/DatabaseService';
import { config } from '../../config';


/**
 * This processor handles the ingestion of emails for a single user's mailbox.
 * If an error occurs during processing (e.g., an API failure),
 * it catches the exception and returns a structured error object instead of throwing.
 * This prevents a single failed mailbox from halting the entire sync cycle for all users.
 * The parent 'sync-cycle-finished' job is responsible for inspecting the results of all
 * 'process-mailbox' jobs, aggregating successes, and reporting detailed failures.
 */
export const processMailboxProcessor = async (job: Job<IProcessMailboxJob, SyncState, string>) => {
	const { ingestionSourceId, userEmail } = job.data;
	const BATCH_SIZE: number = config.meili.indexingBatchSize;
	let emailBatch: PendingEmail[] = [];

	logger.info({ ingestionSourceId, userEmail }, `Processing mailbox for user`);

	const searchService = new SearchService();
	const storageService = new StorageService();
	const databaseService = new DatabaseService();
	const indexingService = new IndexingService(databaseService, searchService, storageService);

	try {
		const source = await IngestionService.findById(ingestionSourceId);
		if (!source) {
			throw new Error(`Ingestion source with ID ${ingestionSourceId} not found`);
		}

		const connector = EmailProviderFactory.createConnector(source);
		const ingestionService = new IngestionService();

		for await (const email of connector.fetchEmails(userEmail, source.syncState)) {
			if (email) {
				const processedEmail = await ingestionService.processEmail(
					email,
					source,
					storageService,
					userEmail
				);
				if (processedEmail) {
					emailBatch.push(processedEmail);
					if (emailBatch.length >= BATCH_SIZE) {
						await indexingService.indexEmailBatch(emailBatch);
						emailBatch = [];
					}
				}
			}
		}

		if (emailBatch.length > 0) {
			await indexingService.indexEmailBatch(emailBatch);
			emailBatch = [];
		}

		const newSyncState = connector.getUpdatedSyncState(userEmail);
		logger.info({ ingestionSourceId, userEmail }, `Finished processing mailbox for user`);
		return newSyncState;
	} catch (error) {
		if (emailBatch.length > 0) {
			await indexingService.indexEmailBatch(emailBatch);
		}

		logger.error({ err: error, ingestionSourceId, userEmail }, 'Error processing mailbox');
		const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
		const processMailboxError: ProcessMailboxError = {
			error: true,
			message: `Failed to process mailbox for ${userEmail}: ${errorMessage}`,
		};
		return processMailboxError;
	}
};
