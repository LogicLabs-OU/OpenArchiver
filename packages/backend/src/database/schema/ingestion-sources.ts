import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { relations } from 'drizzle-orm';

export const ingestionProviderEnum = pgEnum('ingestion_provider', [
	'google_workspace',
	'microsoft_365',
	'generic_imap',
	'pst_import',
	'eml_import',
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
]);

export const ingestionSources = pgTable('ingestion_sources', {
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
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ingestionSourcesRelations = relations(ingestionSources, ({ one }) => ({
	user: one(users, {
		fields: [ingestionSources.userId],
		references: [users.id],
	}),
}));
