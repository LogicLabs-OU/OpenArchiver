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
	/**
	 * Whether unsent drafts from live mailboxes are archived.
	 *
	 * Off by default because a draft is not a record, and archiving one goes wrong in both
	 * directions. Providers that give every auto-save its own identity (Gmail replaces the underlying
	 * message on each save) fill the archive with revisions of an email that was never sent. Servers
	 * that keep one Message-ID from draft to sent do the opposite: the draft is archived first and
	 * the sent message is then taken for a duplicate of it, so the archive keeps an unfinished body
	 * and never learns what was actually sent (#447).
	 *
	 * File imports ignore this setting — a PST or mbox is a snapshot the operator chose to hand over,
	 * and it is ingested once, so neither failure applies and dropping part of it would be data loss.
	 */
	archiveDrafts: process.env.ARCHIVE_DRAFTS === 'true',
};
