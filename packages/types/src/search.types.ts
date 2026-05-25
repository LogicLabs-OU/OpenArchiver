import type { EmailDocument } from './email.types';

export type MatchingStrategy = 'last' | 'all' | 'frequency';

/**
 * Operators allowed on a typed filter clause.
 *
 * - `eq`        — equality (string | number | boolean | ISO timestamp string)
 * - `contains`  — substring match (Meilisearch `CONTAINS`)
 * - `in`        — membership in a list of values
 * - `any`       — array field contains at least one value in the list
 * - `all`       — array field contains all values in the list
 * - `gte` / `lte` — numeric / timestamp comparisons
 * - `between`   — numeric / timestamp inclusive range
 */
export type FilterOp =
	| 'eq'
	| 'contains'
	| 'in'
	| 'any'
	| 'all'
	| 'gte'
	| 'lte'
	| 'between';

export interface StringEqFilter {
	op: 'eq';
	value: string;
}

export interface StringContainsFilter {
	op: 'contains';
	value: string;
}

export interface StringInFilter {
	op: 'in';
	value: string[];
}

export type StringFilter = StringEqFilter | StringContainsFilter | StringInFilter;

export interface StringArrayInFilter {
	op: 'in';
	value: string[];
}

export interface StringArrayAnyFilter {
	op: 'any';
	value: string[];
}

export interface StringArrayAllFilter {
	op: 'all';
	value: string[];
}

export type StringArrayFilter =
	| StringArrayInFilter
	| StringArrayAnyFilter
	| StringArrayAllFilter;

export interface NumberEqFilter {
	op: 'eq';
	value: number;
}

export interface NumberGteFilter {
	op: 'gte';
	value: number;
}

export interface NumberLteFilter {
	op: 'lte';
	value: number;
}

export interface NumberBetweenFilter {
	op: 'between';
	value: [number, number];
}

export type NumberFilter =
	| NumberEqFilter
	| NumberGteFilter
	| NumberLteFilter
	| NumberBetweenFilter;

export interface TimestampEqFilter {
	op: 'eq';
	value: string;
}

export interface TimestampGteFilter {
	op: 'gte';
	value: string;
}

export interface TimestampLteFilter {
	op: 'lte';
	value: string;
}

export interface TimestampBetweenFilter {
	op: 'between';
	value: [string, string];
}

export type TimestampFilter =
	| TimestampEqFilter
	| TimestampGteFilter
	| TimestampLteFilter
	| TimestampBetweenFilter;

export interface BooleanEqFilter {
	op: 'eq';
	value: boolean;
}

export type BooleanFilter = BooleanEqFilter;

/**
 * `path` is special: in addition to the normal value list it accepts an
 * optional `exclude` list rendered as `NOT (path IN [...])`.
 *
 * NOTE (P1): `path` is declared here so the frontend can write against the
 * final shape, but the translator's `FIELD_KINDS` allowlist does NOT yet
 * include `path` — P3 will turn this on by adding `path: 'string'`.
 */
export interface PathFilter {
	op: 'in';
	value: string[];
	exclude?: string[];
}

/**
 * `ingestionSourceId` accepts the typed object form OR a bare string shorthand
 * (kept for backwards compatibility with existing callers that did
 * `filters: { ingestionSourceId: '<uuid>' }`).
 */
export type IngestionSourceFilter = string | StringEqFilter | StringInFilter;

/**
 * Typed filter surface. Includes the FULL P3 surface so frontend code can be
 * written today; the runtime translator gates fields that are not yet
 * filterable in Meilisearch and 400s with "unknown field" until P3 wires them.
 *
 * `attachments.sha256` is nested under `attachments` for a cleaner type shape;
 * the translator flattens it to the dotted Meilisearch field name at render
 * time.
 */
export interface SearchFilters {
	from?: StringFilter;
	to?: StringArrayFilter;
	cc?: StringArrayFilter;
	bcc?: StringArrayFilter;
	subject?: StringFilter;
	timestamp?: TimestampFilter;
	ingestionSourceId?: IngestionSourceFilter;
	userEmail?: StringFilter;

	// --- P3-gated fields below. Translator currently rejects these. ---
	path?: PathFilter;
	hasAttachments?: BooleanFilter | boolean;
	tags?: StringArrayFilter;
	sizeBytes?: NumberFilter;
	isOnLegalHold?: BooleanFilter | boolean;
	threadId?: StringFilter;
	attachments?: {
		sha256?: StringFilter;
	};
}

/**
 * Sort clause for `POST /v1/search`. P1 only allows `'timestamp'`; the type is
 * a union so P3 can extend it (e.g. `'sizeBytes'`, `'subject'`, `'from'`)
 * without a breaking change.
 */
export interface SortClause {
	field: 'timestamp';
	dir: 'asc' | 'desc';
}

export interface SearchQuery {
	/** Optional keyword string. Empty / undefined means "filter-only search". */
	query?: string;
	filters?: SearchFilters;
	sort?: SortClause[];
	page?: number;
	limit?: number;
	matchingStrategy?: MatchingStrategy;
}

export interface SearchHit extends EmailDocument {
	_matchesPosition?: {
		[key: string]: { start: number; length: number; indices?: number[] }[];
	};
	_formatted?: Partial<EmailDocument>;
}

export interface SearchResult {
	hits: SearchHit[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
	processingTimeMs: number;
}
