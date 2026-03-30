import {
	boolean,
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
	type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { relations } from 'drizzle-orm';

export const ingestionProviderEnum = pgEnum('ingestion_provider', [
	'google_workspace',
	'microsoft_365',
	'generic_imap',
	'pst_import',
	'eml_import',
	'mbox_import',
	'smtp_journaling',
]);

export const ingestionStatusEnum = pgEnum('ingestion_status', [
	'active',
	'paused',
	'error',
	'pending_auth',
	'syncing',
	'importing',
	'auth_success',
	'imported',
	'partially_active',
]);

export const ingestionSources = pgTable(
	'ingestion_sources',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		provider: ingestionProviderEnum('provider').notNull(),
		credentials: text('credentials'),
		status: ingestionStatusEnum('status').notNull().default('pending_auth'),
		lastSyncStartedAt: timestamp('last_sync_started_at', { withTimezone: true }),
		lastSyncFinishedAt: timestamp('last_sync_finished_at', { withTimezone: true }),
		lastSyncStatusMessage: text('last_sync_status_message'),
		syncState: jsonb('sync_state'),
		preserveOriginalFile: boolean('preserve_original_file').notNull().default(false),
		/** Self-referencing FK for merge groups. When set, this source is a child
		 *  whose emails are logically grouped with the root source. Flat hierarchy only. */
		mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => ingestionSources.id, {
			onDelete: 'set null',
		}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index('idx_merged_into').on(table.mergedIntoId)]
);

export const ingestionSourcesRelations = relations(ingestionSources, ({ one, many }) => ({
	user: one(users, {
		fields: [ingestionSources.userId],
		references: [users.id],
	}),
	/** The root source this child is merged into (null if this is a root). */
	mergedInto: one(ingestionSources, {
		fields: [ingestionSources.mergedIntoId],
		references: [ingestionSources.id],
		relationName: 'mergedChildren',
	}),
	/** Child sources that are merged into this root. */
	children: many(ingestionSources, {
		relationName: 'mergedChildren',
	}),
}));
