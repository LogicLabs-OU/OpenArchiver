import 'dotenv/config';
import { intFromEnv } from '../helpers/intFromEnv';

export const ingestionConfig = {
	/**
	 * How many process-mailbox jobs the ingestion worker runs at once — i.e. how many mailboxes are
	 * synced in parallel. Increase on servers with more RAM to shorten a full sync.
	 */
	workerConcurrency: intFromEnv('INGESTION_WORKER_CONCURRENCY', 5, 1, 32),
	/**
	 * How many emails WITHIN one mailbox are archived at once.
	 *
	 * Fetching from the provider and writing to storage/Postgres used to alternate: the loop awaited
	 * each email's write before asking the connector for the next one, so a mailbox never had a
	 * download and a write happening at the same time. This overlaps them.
	 *
	 * Kept low by default, and lower than workerConcurrency, because the two multiply — a worker can
	 * hold workerConcurrency x this many emails' attachment buffers in memory at once, and the
	 * ingestion worker runs without a heap ceiling.
	 */
	emailConcurrency: intFromEnv('INGESTION_EMAIL_CONCURRENCY', 3, 1, 32),
};
