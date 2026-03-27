import {
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { ingestionSources } from './ingestion-sources';

export const journalingSourceStatusEnum = pgEnum('journaling_source_status', ['active', 'paused']);

export const journalingSources = pgTable('journaling_sources', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	/** CIDR blocks or IP addresses allowed to send journal reports */
	allowedIps: jsonb('allowed_ips').notNull().$type<string[]>(),
	/** Whether to reject non-TLS connections (GDPR compliance) */
	requireTls: boolean('require_tls').notNull().default(true),
	/** Optional SMTP AUTH username */
	smtpUsername: text('smtp_username'),
	/** Bcrypt-hashed SMTP AUTH password */
	smtpPasswordHash: text('smtp_password_hash'),
	status: journalingSourceStatusEnum('status').notNull().default('active'),
	/** The backing ingestion source that owns all archived emails */
	ingestionSourceId: uuid('ingestion_source_id')
		.notNull()
		.references(() => ingestionSources.id, { onDelete: 'cascade' }),
	/** Persisted SMTP routing address generated at creation time (immutable unless regenerated) */
	routingAddress: text('routing_address').notNull(),
	/** Running count of emails received via this journaling endpoint */
	totalReceived: integer('total_received').notNull().default(0),
	/** Timestamp of the last email received */
	lastReceivedAt: timestamp('last_received_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const journalingSourcesRelations = relations(journalingSources, ({ one }) => ({
	ingestionSource: one(ingestionSources, {
		fields: [journalingSources.ingestionSourceId],
		references: [ingestionSources.id],
	}),
}));
