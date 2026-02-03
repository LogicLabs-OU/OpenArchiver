import { relations } from 'drizzle-orm';
import { pgTable, text, uuid, bigint, primaryKey, index } from 'drizzle-orm/pg-core';
import { archivedEmails } from './archived-emails';
import { ingestionSources } from './ingestion-sources';

export const attachments = pgTable(
	'attachments',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		filename: text('filename').notNull(),
		mimeType: text('mime_type'),
		sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
		contentHashSha256: text('content_hash_sha256').notNull(),
		storagePath: text('storage_path').notNull(),
		ingestionSourceId: uuid('ingestion_source_id').references(() => ingestionSources.id, {
			onDelete: 'cascade',
		}),
	},
	(table) => [index('source_hash_idx').on(table.ingestionSourceId, table.contentHashSha256)]
);

export const emailAttachments = pgTable(
	'email_attachments',
	{
		emailId: uuid('email_id')
			.notNull()
			.references(() => archivedEmails.id, { onDelete: 'cascade' }),
		attachmentId: uuid('attachment_id')
			.notNull()
			.references(() => attachments.id, { onDelete: 'restrict' }),
	},
	(t) => ({
		pk: primaryKey({ columns: [t.emailId, t.attachmentId] }),
	})
);

export const attachmentsRelations = relations(attachments, ({ many }) => ({
	emailAttachments: many(emailAttachments),
}));

export const emailAttachmentsRelations = relations(emailAttachments, ({ one }) => ({
	archivedEmail: one(archivedEmails, {
		fields: [emailAttachments.emailId],
		references: [archivedEmails.id],
	}),
	attachment: one(attachments, {
		fields: [emailAttachments.attachmentId],
		references: [attachments.id],
	}),
}));
