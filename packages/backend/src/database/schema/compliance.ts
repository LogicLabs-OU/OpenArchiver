import { relations } from 'drizzle-orm';
import {
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core';
import { archivedEmails } from './archived-emails';
import { users } from './users';

// --- Enums ---

export const retentionActionEnum = pgEnum('retention_action', [
	'delete_permanently',
	'notify_admin',
]);

// --- Tables ---

export const retentionPolicies = pgTable('retention_policies', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull().unique(),
	description: text('description'),
	priority: integer('priority').notNull(),
	retentionPeriodDays: integer('retention_period_days').notNull(),
	actionOnExpiry: retentionActionEnum('action_on_expiry').notNull(),
	isEnabled: boolean('is_enabled').notNull().default(true),
	conditions: jsonb('conditions'),
	/**
	 * Array of ingestion source UUIDs this policy is restricted to.
	 * null means the policy applies to all ingestion sources.
	 */
	ingestionScope: jsonb('ingestion_scope').$type<string[] | null>().default(null),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const retentionLabels = pgTable('retention_labels', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	retentionPeriodDays: integer('retention_period_days').notNull(),
	description: text('description'),
	isDisabled: boolean('is_disabled').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailRetentionLabels = pgTable('email_retention_labels', {
	emailId: uuid('email_id')
		.references(() => archivedEmails.id, { onDelete: 'cascade' })
		.notNull(),
	labelId: uuid('label_id')
		.references(() => retentionLabels.id, { onDelete: 'cascade' })
		.notNull(),
	appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
	appliedByUserId: uuid('applied_by_user_id').references(() => users.id),
}, (t) => [
	primaryKey({ columns: [t.emailId, t.labelId] }),
]);

export const retentionEvents = pgTable('retention_events', {
	id: uuid('id').defaultRandom().primaryKey(),
	eventName: varchar('event_name', { length: 255 }).notNull(),
	eventType: varchar('event_type', { length: 100 }).notNull(),
	eventTimestamp: timestamp('event_timestamp', { withTimezone: true }).notNull(),
	targetCriteria: jsonb('target_criteria').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ediscoveryCases = pgTable('ediscovery_cases', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull().unique(),
	description: text('description'),
	status: text('status').notNull().default('open'),
	createdByIdentifier: text('created_by_identifier').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const legalHolds = pgTable('legal_holds', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	reason: text('reason'),
	isActive: boolean('is_active').notNull().default(true),
	// Optional link to ediscovery cases for backward compatibility or future use
	caseId: uuid('case_id').references(() => ediscoveryCases.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailLegalHolds = pgTable(
	'email_legal_holds',
	{
		emailId: uuid('email_id')
			.references(() => archivedEmails.id, { onDelete: 'cascade' })
			.notNull(),
		legalHoldId: uuid('legal_hold_id')
			.references(() => legalHolds.id, { onDelete: 'cascade' })
			.notNull(),
		appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
		appliedByUserId: uuid('applied_by_user_id').references(() => users.id),
	},
	(t) => [
		primaryKey({ columns: [t.emailId, t.legalHoldId] }),
	],
);

export const exportJobs = pgTable('export_jobs', {
	id: uuid('id').primaryKey().defaultRandom(),
	caseId: uuid('case_id').references(() => ediscoveryCases.id, { onDelete: 'set null' }),
	format: text('format').notNull(),
	status: text('status').notNull().default('pending'),
	query: jsonb('query').notNull(),
	filePath: text('file_path'),
	createdByIdentifier: text('created_by_identifier').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	completedAt: timestamp('completed_at', { withTimezone: true }),
});

// --- Relations ---

export const retentionPoliciesRelations = relations(retentionPolicies, ({ many }) => ({
	// Add relations if needed
}));

export const retentionLabelsRelations = relations(retentionLabels, ({ many }) => ({
	emailRetentionLabels: many(emailRetentionLabels),
}));

export const emailRetentionLabelsRelations = relations(emailRetentionLabels, ({ one }) => ({
	label: one(retentionLabels, {
		fields: [emailRetentionLabels.labelId],
		references: [retentionLabels.id],
	}),
	email: one(archivedEmails, {
		fields: [emailRetentionLabels.emailId],
		references: [archivedEmails.id],
	}),
	appliedByUser: one(users, {
		fields: [emailRetentionLabels.appliedByUserId],
		references: [users.id],
	}),
}));

export const legalHoldsRelations = relations(legalHolds, ({ one, many }) => ({
	emailLegalHolds: many(emailLegalHolds),
	ediscoveryCase: one(ediscoveryCases, {
		fields: [legalHolds.caseId],
		references: [ediscoveryCases.id],
	}),
}));

export const emailLegalHoldsRelations = relations(emailLegalHolds, ({ one }) => ({
	legalHold: one(legalHolds, {
		fields: [emailLegalHolds.legalHoldId],
		references: [legalHolds.id],
	}),
	email: one(archivedEmails, {
		fields: [emailLegalHolds.emailId],
		references: [archivedEmails.id],
	}),
}));

export const ediscoveryCasesRelations = relations(ediscoveryCases, ({ many }) => ({
	legalHolds: many(legalHolds),
	exportJobs: many(exportJobs),
}));

export const exportJobsRelations = relations(exportJobs, ({ one }) => ({
	ediscoveryCase: one(ediscoveryCases, {
		fields: [exportJobs.caseId],
		references: [ediscoveryCases.id],
	}),
}));
