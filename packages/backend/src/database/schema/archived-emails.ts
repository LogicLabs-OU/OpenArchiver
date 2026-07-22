import { relations, sql } from 'drizzle-orm';
import {
	boolean,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	bigint,
	index,
} from 'drizzle-orm/pg-core';
import { ingestionSources } from './ingestion-sources';

export const archivedEmails = pgTable(
	'archived_emails',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		threadId: text('thread_id'),
		ingestionSourceId: uuid('ingestion_source_id')
			.notNull()
			.references(() => ingestionSources.id, { onDelete: 'cascade' }),
		userEmail: text('user_email').notNull(),
		messageIdHeader: text('message_id_header'),
		/** The provider-specific message ID (e.g., Gmail API ID, Graph API ID).
		 * Used by the pre-fetch duplicate check to avoid unnecessary API calls during retries. */
		providerMessageId: text('provider_message_id'),
		sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
		subject: text('subject'),
		senderName: text('sender_name'),
		senderEmail: text('sender_email').notNull(),
		recipients: jsonb('recipients'),
		storagePath: text('storage_path').notNull(),
		storageHashSha256: text('storage_hash_sha256').notNull(),
		sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
		isIndexed: boolean('is_indexed').notNull().default(false),
		/** Number of failed indexing attempts. The reconcile job stops retrying an
		 * email once this reaches MAX_INDEX_ATTEMPTS, preventing poison emails from
		 * churning the queue forever. */
		indexAttempts: integer('index_attempts').notNull().default(0),
		hasAttachments: boolean('has_attachments').notNull().default(false),
		isOnLegalHold: boolean('is_on_legal_hold').notNull().default(false),
		isJournaled: boolean('is_journaled').default(false),
		archivedAt: timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
		path: text('path'),
		tags: jsonb('tags'),
	},
	(table) => [
		index('thread_id_idx').on(table.threadId),
		index('provider_msg_source_idx').on(table.providerMessageId, table.ingestionSourceId),
		// Mirror of provider_msg_source_idx for the messageIdHeader dedup branch. Without
		// this, doesEmailExist's OR (providerMessageId | messageIdHeader) and processEmail's
		// messageIdHeader lookups sequential-scan archived_emails on every ingested email,
		// pinning multiple CPU cores during re-syncs of large archives.
		index('msgid_header_source_idx').on(table.messageIdHeader, table.ingestionSourceId),
		// Supports the preserve-original / GoBD byte-hash dedup (hashDuplicate and
		// hashExistingOther in IngestionService.processEmail), which filter on
		// storage_hash_sha256 + ingestion_source_id. Without this, every email ingested by
		// a preserve-original source sequential-scans archived_emails, the same
		// full-scan-per-email pathology msgid_header_source_idx fixed for the default path.
		index('storage_hash_source_idx').on(table.storageHashSha256, table.ingestionSourceId),
		// Partial index for the reconcile/reindex scan. Keyed on id (the keyset
		// pagination order) and filtered to unindexed rows, so once the archive is
		// mostly indexed the index stays tiny and the "find unindexed, ordered by id"
		// scan stays cheap even with tens of millions of rows.
		index('archived_emails_unindexed_idx')
			.on(table.id)
			.where(sql`${table.isIndexed} = false`),
	]
);

export const archivedEmailsRelations = relations(archivedEmails, ({ one }) => ({
	ingestionSource: one(ingestionSources, {
		fields: [archivedEmails.ingestionSourceId],
		references: [ingestionSources.id],
	}),
}));
