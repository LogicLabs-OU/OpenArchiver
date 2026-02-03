import { bigserial, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { auditLogActionEnum, auditLogTargetTypeEnum } from './enums';

export const auditLogs = pgTable('audit_logs', {
	// A unique, sequential, and gapless primary key for ordering.
	id: bigserial('id', { mode: 'number' }).primaryKey(),

	// The SHA-256 hash of the preceding log entry's `currentHash`.
	previousHash: varchar('previous_hash', { length: 64 }),

	// A high-precision, UTC timestamp of when the event occurred.
	timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),

	// A stable identifier for the actor who performed the action.
	actorIdentifier: text('actor_identifier').notNull(),

	// The IP address from which the action was initiated.
	actorIp: text('actor_ip'),

	// A standardized, machine-readable identifier for the event.
	actionType: auditLogActionEnum('action_type').notNull(),

	// The type of resource that was affected by the action.
	targetType: auditLogTargetTypeEnum('target_type'),

	// The unique identifier of the affected resource.
	targetId: text('target_id'),

	// A JSON object containing specific, contextual details of the event.
	details: jsonb('details'),

	// The SHA-256 hash of this entire log entry's contents.
	currentHash: varchar('current_hash', { length: 64 }).notNull(),
});
