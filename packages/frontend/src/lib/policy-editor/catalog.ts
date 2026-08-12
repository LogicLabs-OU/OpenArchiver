import type { AppActions, AppSubjects } from '@open-archiver/types';

/**
 * What the visual policy editor is allowed to offer.
 *
 * The backend validator only checks that actions and subjects are known values — conditions are
 * never validated server-side. This catalog is therefore the real guardrail: it lists the
 * condition fields that actually take effect at enforcement time, so the editor cannot produce a
 * policy that silently does nothing or breaks a search filter.
 */

export const ALL_ACTIONS: readonly AppActions[] = [
	'manage',
	'create',
	'read',
	'update',
	'delete',
	'search',
	'export',
	'sync',
];

export const ALL_SUBJECTS: readonly AppSubjects[] = [
	'archive',
	'ingestion',
	'settings',
	'users',
	'roles',
	'dashboard',
	'all',
];

/**
 * Subjects whose conditions are evaluated against a real record.
 *
 * `settings`, `users`, `roles` and `dashboard` are only ever checked against the resource type —
 * no route loads one of those records for the permission check, and no listing is filtered by
 * policy — so conditions on them have no effect at all. `all` is meaningful but is handled
 * separately, see `catalogForSubjects`.
 */
export const CONDITION_BEARING_SUBJECTS = ['ingestion', 'archive'] as const;
export type ConditionBearingSubject = (typeof CONDITION_BEARING_SUBJECTS)[number];

/** is / is not / any of / none of — the operators both query translators support. */
export type UiOperator = 'eq' | 'ne' | 'in' | 'nin';
export const ALL_OPERATORS: readonly UiOperator[] = ['eq', 'ne', 'in', 'nin'];

export type Effect = 'allow' | 'deny';

/** Decides which value editor a condition row renders. */
export type FieldKind = 'sourceId' | 'userRef' | 'email' | 'enum' | 'text';

export interface FieldDef {
	/** Condition key exactly as it is serialized into the policy. */
	key: string;
	kind: FieldKind;
	/** Allowed values for `kind: 'enum'`. */
	enumValues?: readonly string[];
	allowedOperators: readonly UiOperator[];
}

export const INGESTION_PROVIDERS = [
	'google_workspace',
	'microsoft_365',
	'generic_imap',
	'pst_import',
	'eml_import',
	'mbox_import',
	'smtp_journaling',
] as const;

export const INGESTION_STATUSES = [
	'active',
	'paused',
	'error',
	'pending_auth',
	'syncing',
	'importing',
	'auth_success',
	'imported',
	'partially_active',
] as const;

/**
 * Condition fields per subject.
 *
 * `ingestion` rules are only ever applied to a database query, so any column works. `archive`
 * rules are compiled for the database *and* the search engine, so only fields the search index
 * can filter on are listed — anything else would make search fail for the whole role.
 */
export const SUBJECT_FIELDS: Record<ConditionBearingSubject, readonly FieldDef[]> = {
	ingestion: [
		{ key: 'id', kind: 'sourceId', allowedOperators: ALL_OPERATORS },
		{ key: 'userId', kind: 'userRef', allowedOperators: ALL_OPERATORS },
		{ key: 'name', kind: 'text', allowedOperators: ALL_OPERATORS },
		{
			key: 'provider',
			kind: 'enum',
			enumValues: INGESTION_PROVIDERS,
			allowedOperators: ALL_OPERATORS,
		},
		{
			key: 'status',
			kind: 'enum',
			enumValues: INGESTION_STATUSES,
			allowedOperators: ALL_OPERATORS,
		},
	],
	archive: [
		{ key: 'userEmail', kind: 'email', allowedOperators: ALL_OPERATORS },
		{ key: 'ingestionSourceId', kind: 'sourceId', allowedOperators: ALL_OPERATORS },
		// The search-filter translator expands this key by looking up the owner's sources, and
		// that branch only runs for a plain value — an "any of" list would reach the search
		// engine as an unknown attribute and break the query.
		{ key: 'ingestionSource.userId', kind: 'userRef', allowedOperators: ['eq'] },
	],
};

/**
 * Stands in for the signed-in user's id. Substitution happens on the serialized policy, so it is
 * equally valid on its own or inside a list of values.
 */
export const CURRENT_USER_PLACEHOLDER = '${user.id}';

export const isConditionBearing = (subject: AppSubjects): subject is ConditionBearingSubject =>
	(CONDITION_BEARING_SUBJECTS as readonly string[]).includes(subject);

export type CatalogResult =
	| { kind: 'fields'; fields: readonly FieldDef[] }
	/**
	 * `all` matches every subject, so its conditions would be evaluated against records of every
	 * type. That is a valid policy, but not one the editor draws — it is left to JSON mode.
	 */
	| { kind: 'wildcard' }
	/** No selected subject carries conditions, so a condition would never be evaluated. */
	| { kind: 'inert' }
	/** Several condition-bearing subjects were selected and they share no fields. */
	| { kind: 'conflict' };

/**
 * The condition fields available for a statement.
 *
 * A statement applies one set of conditions to every subject it names, so only fields valid for
 * *all* of the condition-bearing subjects can be offered. Subjects that carry no conditions are
 * ignored — mixing one in is harmless.
 */
export function catalogForSubjects(subjects: readonly AppSubjects[]): CatalogResult {
	if (subjects.includes('all')) {
		return { kind: 'wildcard' };
	}

	const bearing = subjects.filter(isConditionBearing);
	if (bearing.length === 0) {
		return { kind: 'inert' };
	}

	let shared: readonly FieldDef[] = SUBJECT_FIELDS[bearing[0]];
	for (const subject of bearing.slice(1)) {
		const next = SUBJECT_FIELDS[subject];
		shared = shared.filter((field) => next.some((f) => f.key === field.key));
	}

	return shared.length > 0 ? { kind: 'fields', fields: shared } : { kind: 'conflict' };
}

export function findField(subjects: readonly AppSubjects[], key: string): FieldDef | undefined {
	const catalog = catalogForSubjects(subjects);
	return catalog.kind === 'fields' ? catalog.fields.find((f) => f.key === key) : undefined;
}

/** Operators that carry a list of values rather than a single one. */
export const isMultiValueOperator = (operator: UiOperator): boolean =>
	operator === 'in' || operator === 'nin';
