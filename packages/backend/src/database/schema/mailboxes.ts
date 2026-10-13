import { relations } from 'drizzle-orm';
import {
	bigint,
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
import { ingestionSources, ingestionProviderEnum } from './ingestion-sources';
import { users } from './users';

/** What kind of thing owns this mailbox. `unknown` means nothing has said yet, and counts as a seat. */
export const mailboxKindEnum = pgEnum('mailbox_kind', [
	'user',
	'shared',
	'room',
	'equipment',
	'unknown',
]);

/** What decided `kind`. Provider evidence outranks every declaration an administrator can make. */
export const mailboxKindEvidenceEnum = pgEnum('mailbox_kind_evidence', [
	'provider',
	'pattern',
	'admin',
	'none',
]);

/** What merged this mailbox into its seat identity, if anything did. */
export const seatIdentityEvidenceEnum = pgEnum('seat_identity_evidence', [
	'provider',
	'alias_domain',
	'admin_link',
	'address',
]);

/**
 * One row per archived mailbox: the registry seat accounting is computed from.
 *
 * Before this table the only record of a mailbox was the `user_email` string repeated on every
 * `archived_emails` row, so a seat was `count(DISTINCT user_email)` and nothing could be said about
 * what a mailbox *is* — a person, a shared `info@` address, or the same person under a second
 * domain. Each row here gathers three separate kinds of knowledge about one address, and the
 * columns are grouped by who is allowed to write them:
 *
 *   - Provider facts (`providerObjectId` … `hasMailbox`) are written only by the OSS ingestion
 *     path, from what the directory says. They are overwritten on every listing, so a mailbox
 *     converted upstream corrects itself on the next sync.
 *   - Administrator declarations (`adminKind`, `linkedToMailboxId` and their provenance columns)
 *     are written only through the enterprise seats API, and only where the provider has no
 *     opinion. They are reported to the license server, never silently trusted.
 *   - Resolved output (`kind`, `kindEvidence`, `identityKey`, `identityEvidence`) is derived from
 *     the other two by reconciliation and must never be hand-edited: any write is overwritten on
 *     the next run.
 *
 * Part of the open-source edition, as is the seat engine that reads it (`services/seats/`): an
 * OSS deployment has to be able to see how many seats a licence would need before buying one, and
 * the ingestion worker that captures provider facts loads no enterprise code in any case. Only
 * reporting the result to the licence server is an enterprise concern.
 */
export const mailboxes = pgTable(
	'mailboxes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/**
		 * The canonical mailbox address, `lower(btrim())` — byte-identical to what
		 * `normalizeEmailAddress` writes into `archived_emails.user_email`, so the two join
		 * without a function on either side.
		 */
		address: text('address').notNull().unique(),
		displayName: text('display_name'),
		provider: ingestionProviderEnum('provider').notNull(),
		/** The source whose listing produced this row; may be a child of a merge group. */
		sourceId: uuid('source_id').references(() => ingestionSources.id, { onDelete: 'set null' }),
		/** The merge root (`mergedIntoId ?? id`). Two mailboxes under one root share a directory. */
		rootSourceId: uuid('root_source_id').references(() => ingestionSources.id, {
			onDelete: 'set null',
		}),

		// ── Provider facts ────────────────────────────────────────────────
		/** The directory's own id for this object (Graph/Google user id). Null off-directory. */
		providerObjectId: text('provider_object_id'),
		/** Every other address reaching this mailbox, lowercased. Graph proxyAddresses, Google aliases. */
		providerAliases: jsonb('provider_aliases').notNull().$type<string[]>().default([]),
		/** The provider's classification. Null means the provider has no opinion, not "user". */
		providerKind: mailboxKindEnum('provider_kind'),
		/** When the purpose was last read, so it is refreshed periodically rather than every cycle. */
		purposeCheckedAt: timestamp('purpose_checked_at', { withTimezone: true }),
		licensed: boolean('licensed'),
		accountEnabled: boolean('account_enabled'),
		/** False once a fetch proved the account owns no mailbox — an unlicensed member, typically. */
		hasMailbox: boolean('has_mailbox'),
		/** The last directory listing that returned this mailbox. Drives the "departed" signal. */
		lastListedAt: timestamp('last_listed_at', { withTimezone: true }),

		// ── Archive facts ─────────────────────────────────────────────────
		/**
		 * Whether any archived email is still filed under this address. This is the billing
		 * definition: a mailbox deleted upstream keeps its seat while its emails are retained.
		 */
		active: boolean('active').notNull().default(false),
		emailCount: bigint('email_count', { mode: 'number' }).notNull().default(0),
		lastArchivedAt: timestamp('last_archived_at', { withTimezone: true }),
		/**
		 * An artefact rather than a mailbox: the literal `default`, `journal-unknown`, or a
		 * `default_fallback@…` address invented when no owner could be resolved. Never a seat, and
		 * no administrator declaration applies to it.
		 */
		isSentinel: boolean('is_sentinel').notNull().default(false),

		// ── Administrator declarations ────────────────────────────────────
		/**
		 * What an administrator says this mailbox is. `user` always wins (a real person behind
		 * `info@`); `shared` applies only where the provider stayed silent.
		 */
		adminKind: mailboxKindEnum('admin_kind'),
		adminDeclaredBy: uuid('admin_declared_by').references(() => users.id, {
			onDelete: 'set null',
		}),
		adminDeclaredAt: timestamp('admin_declared_at', { withTimezone: true }),
		adminDeclaredReason: text('admin_declared_reason'),
		/**
		 * Another mailbox this one belongs to, when only a human can know they are one person —
		 * a PST import and a live mailbox, say. Flat: the target must not itself be linked.
		 */
		linkedToMailboxId: uuid('linked_to_mailbox_id').references(
			(): AnyPgColumn => mailboxes.id,
			{ onDelete: 'set null' }
		),
		linkedBy: uuid('linked_by').references(() => users.id, { onDelete: 'set null' }),
		linkedAt: timestamp('linked_at', { withTimezone: true }),
		linkReason: text('link_reason'),

		// ── Resolved output ───────────────────────────────────────────────
		kind: mailboxKindEnum('kind').notNull().default('unknown'),
		kindEvidence: mailboxKindEvidenceEnum('kind_evidence').notNull().default('none'),
		/** Mailboxes sharing this key are one person and bill as one seat. */
		identityKey: text('identity_key').notNull(),
		identityEvidence: seatIdentityEvidenceEnum('identity_evidence')
			.notNull()
			.default('address'),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('mailboxes_identity_key_idx').on(table.identityKey),
		index('mailboxes_root_source_idx').on(table.rootSourceId),
		index('mailboxes_provider_object_idx').on(table.provider, table.providerObjectId),
	]
);

export const mailboxesRelations = relations(mailboxes, ({ one }) => ({
	source: one(ingestionSources, {
		fields: [mailboxes.sourceId],
		references: [ingestionSources.id],
		relationName: 'mailboxSource',
	}),
	rootSource: one(ingestionSources, {
		fields: [mailboxes.rootSourceId],
		references: [ingestionSources.id],
		relationName: 'mailboxRootSource',
	}),
	linkedTo: one(mailboxes, {
		fields: [mailboxes.linkedToMailboxId],
		references: [mailboxes.id],
		relationName: 'mailboxIdentityLink',
	}),
}));
