import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ingestionSources } from './ingestion-sources';
import { relations } from 'drizzle-orm';

/**
 * Tracks the progress of a single sync cycle (initial import or continuous sync).
 * Used as the coordination layer to replace BullMQ FlowProducer parent/child tracking.
 * Each process-mailbox job atomically increments completed/failed counters here,
 * and the last job to finish dispatches the sync-cycle-finished job.
 */
export const syncSessions = pgTable('sync_sessions', {
	id: uuid('id').primaryKey().defaultRandom(),
	ingestionSourceId: uuid('ingestion_source_id')
		.notNull()
		.references(() => ingestionSources.id, { onDelete: 'cascade' }),
	isInitialImport: boolean('is_initial_import').notNull().default(false),
	totalMailboxes: integer('total_mailboxes').notNull().default(0),
	completedMailboxes: integer('completed_mailboxes').notNull().default(0),
	failedMailboxes: integer('failed_mailboxes').notNull().default(0),
	/** Aggregated error messages from all failed process-mailbox jobs */
	errorMessages: text('error_messages').array().notNull().default([]),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	/**
	 * Updated each time a process-mailbox job reports its result.
	 * Used to detect genuinely stuck sessions (no activity for N minutes) vs.
	 * large imports that are still actively running.
	 */
	lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncSessionsRelations = relations(syncSessions, ({ one }) => ({
	ingestionSource: one(ingestionSources, {
		fields: [syncSessions.ingestionSourceId],
		references: [ingestionSources.id],
	}),
}));
