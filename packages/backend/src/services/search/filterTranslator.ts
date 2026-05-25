import type { SearchFilters } from '@open-archiver/types';
import { IngestionService } from '../IngestionService';

/**
 * Thrown when a filter clause is structurally invalid: unknown field, op not
 * allowed for the field's kind, empty array, type mismatch, unparseable date.
 *
 * The controller layer catches this and returns a 400 with the field/reason
 * surfaced to the API client. Never include raw user input in the reason
 * verbatim if it could be sensitive — but the values we surface here are field
 * names and op names, which are bounded by the allowlist.
 */
export class FilterValidationError extends Error {
	public readonly field: string;
	public readonly reason: string;

	constructor(field: string, reason: string) {
		super(`Invalid filter on field "${field}": ${reason}`);
		this.name = 'FilterValidationError';
		this.field = field;
		this.reason = reason;
	}
}

type FieldKind = 'string' | 'stringArray' | 'number' | 'timestamp' | 'boolean';

/**
 * Allowlist of fields currently filterable in Meilisearch.
 *
 * P1 surface only. P3 will extend this map with `path`, `tags`,
 * `hasAttachments`, `sizeBytes`, `isOnLegalHold`, `threadId`, `subject`, and
 * `attachments.sha256` once `configureEmailIndex` adds them to
 * `filterableAttributes`.
 *
 * The translator is the single source of truth for "is this field wired through
 * yet" — see §2.4 of docs/plans/advanced-search.md.
 */
const FIELD_KINDS: Record<string, FieldKind> = {
	from: 'string',
	to: 'stringArray',
	cc: 'stringArray',
	bcc: 'stringArray',
	timestamp: 'timestamp',
	ingestionSourceId: 'string',
	userEmail: 'string',
};

/** Operators allowed per field kind. */
const OPS_BY_KIND: Record<FieldKind, ReadonlyArray<string>> = {
	string: ['eq', 'contains', 'in'],
	stringArray: ['in', 'any', 'all'],
	number: ['eq', 'gte', 'lte', 'between'],
	timestamp: ['eq', 'gte', 'lte', 'between'],
	boolean: ['eq'],
};

const MAX_ARRAY_LEN = 100;
const MAX_ALL_LEN = 50;

/** SQL-style single-quote escape (Meilisearch convention). */
function escapeString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function renderStringList(field: string, values: string[]): string {
	const inList = values.map((v) => {
		if (typeof v !== 'string') {
			throw new FilterValidationError(field, 'array contains non-string value');
		}
		return escapeString(v);
	});
	return `[${inList.join(', ')}]`;
}

function parseTimestamp(field: string, value: unknown): number {
	if (typeof value !== 'string') {
		throw new FilterValidationError(field, 'timestamp must be an ISO 8601 string');
	}
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) {
		throw new FilterValidationError(field, `unparseable timestamp: ${value}`);
	}
	return parsed;
}

function ensureNumber(field: string, value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new FilterValidationError(field, 'value must be a finite number');
	}
	return value;
}

function ensureString(field: string, value: unknown): string {
	if (typeof value !== 'string') {
		throw new FilterValidationError(field, 'value must be a string');
	}
	return value;
}

function ensureBoolean(field: string, value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new FilterValidationError(field, 'value must be a boolean');
	}
	return value;
}

function ensureArray(field: string, value: unknown, max: number): unknown[] {
	if (!Array.isArray(value)) {
		throw new FilterValidationError(field, 'value must be an array');
	}
	if (value.length === 0) {
		throw new FilterValidationError(field, 'array must not be empty');
	}
	if (value.length > max) {
		throw new FilterValidationError(
			field,
			`array exceeds ${max}-element cap (got ${value.length})`
		);
	}
	return value;
}

interface FilterClause {
	op: string;
	value?: unknown;
	[k: string]: unknown;
}

/**
 * Coerces shorthand forms into the canonical `{op, value}` shape.
 *
 * - Bare string for `ingestionSourceId` → `{op: 'eq', value: <string>}` (kept
 *   for backwards compatibility with the existing `?filters[ingestionSourceId]=<id>` form).
 * - Bare boolean for any boolean field → `{op: 'eq', value: <boolean>}`.
 */
function normalizeClause(field: string, raw: unknown, kind: FieldKind): FilterClause {
	if (kind === 'string' && typeof raw === 'string') {
		return { op: 'eq', value: raw };
	}
	if (kind === 'boolean' && typeof raw === 'boolean') {
		return { op: 'eq', value: raw };
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new FilterValidationError(
			field,
			'expected object of shape {op, value} or shorthand'
		);
	}
	const clause = raw as FilterClause;
	if (typeof clause.op !== 'string') {
		throw new FilterValidationError(field, 'missing or non-string `op`');
	}
	return clause;
}

function checkOp(field: string, kind: FieldKind, op: string): void {
	const allowed = OPS_BY_KIND[kind];
	if (!allowed.includes(op)) {
		throw new FilterValidationError(
			field,
			`op "${op}" not allowed for field kind "${kind}"`
		);
	}
}

/**
 * Render a non-ingestion clause. Returns the Meilisearch filter expression
 * (without the outer ` AND ` join).
 */
function renderClause(field: string, kind: FieldKind, clause: FilterClause): string {
	const { op } = clause;
	checkOp(field, kind, op);

	switch (kind) {
		case 'string': {
			if (op === 'eq') {
				return `${field} = ${escapeString(ensureString(field, clause.value))}`;
			}
			if (op === 'contains') {
				return `${field} CONTAINS ${escapeString(ensureString(field, clause.value))}`;
			}
			// in
			const arr = ensureArray(field, clause.value, MAX_ARRAY_LEN) as string[];
			return `${field} IN ${renderStringList(field, arr)}`;
		}
		case 'stringArray': {
			const cap = op === 'all' ? MAX_ALL_LEN : MAX_ARRAY_LEN;
			const arr = ensureArray(field, clause.value, cap) as string[];
			if (op === 'in' || op === 'any') {
				return `${field} IN ${renderStringList(field, arr)}`;
			}
			// all → conjunction of equality clauses (Meilisearch has no native ALL)
			return arr
				.map((v) => `${field} = ${escapeString(ensureString(field, v))}`)
				.join(' AND ');
		}
		case 'number': {
			if (op === 'between') {
				const tuple = ensureArray(field, clause.value, 2);
				if (tuple.length !== 2) {
					throw new FilterValidationError(field, 'between requires [low, high]');
				}
				const lo = ensureNumber(field, tuple[0]);
				const hi = ensureNumber(field, tuple[1]);
				return `${field} ${lo} TO ${hi}`;
			}
			const num = ensureNumber(field, clause.value);
			if (op === 'eq') return `${field} = ${num}`;
			if (op === 'gte') return `${field} >= ${num}`;
			return `${field} <= ${num}`; // lte
		}
		case 'timestamp': {
			if (op === 'between') {
				const tuple = ensureArray(field, clause.value, 2);
				if (tuple.length !== 2) {
					throw new FilterValidationError(field, 'between requires [low, high]');
				}
				const lo = parseTimestamp(field, tuple[0]);
				const hi = parseTimestamp(field, tuple[1]);
				return `${field} ${lo} TO ${hi}`;
			}
			const ts = parseTimestamp(field, clause.value);
			if (op === 'eq') return `${field} = ${ts}`;
			if (op === 'gte') return `${field} >= ${ts}`;
			return `${field} <= ${ts}`; // lte
		}
		case 'boolean': {
			const b = ensureBoolean(field, clause.value);
			return `${field} = ${b ? 'true' : 'false'}`;
		}
	}
}

/**
 * Special-case ingestionSourceId: expand into the full merge group via
 * IngestionService.findGroupSourceIds. Accepts bare-string and `{op:'eq', value}`
 * shorthand forms — both are flattened to a single source ID, which we expand.
 *
 * `{op: 'in', value: [...]}` is also accepted: we expand each ID and concat.
 */
async function renderIngestionSourceId(raw: unknown): Promise<string> {
	const field = 'ingestionSourceId';
	let ids: string[] = [];
	if (typeof raw === 'string') {
		ids = [raw];
	} else if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
		const clause = raw as FilterClause;
		if (clause.op === 'eq') {
			ids = [ensureString(field, clause.value)];
		} else if (clause.op === 'in') {
			ids = ensureArray(field, clause.value, MAX_ARRAY_LEN).map((v) =>
				ensureString(field, v)
			);
		} else {
			throw new FilterValidationError(
				field,
				`op "${clause.op}" not allowed for field kind "string"`
			);
		}
	} else {
		throw new FilterValidationError(field, 'expected string or {op, value}');
	}

	const expanded: string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		const groupIds = await IngestionService.findGroupSourceIds(id);
		for (const gid of groupIds) {
			if (!seen.has(gid)) {
				seen.add(gid);
				expanded.push(gid);
			}
		}
	}

	if (expanded.length === 1) {
		return `${field} = ${escapeString(expanded[0])}`;
	}
	return `${field} IN ${renderStringList(field, expanded)}`;
}

/**
 * Special-case `path`: accepts an optional `exclude: string[]` alongside `value`.
 * Renders as `(path IN [...value]) AND NOT (path IN [...exclude])`.
 *
 * NOTE: currently unreachable because `path` is not in FIELD_KINDS. Kept here
 * so P3 only has to flip on `path: 'string'` in FIELD_KINDS and the render
 * logic is already in place. Same shape will apply to any future field that
 * needs an exclude list.
 */
function renderPathClause(raw: unknown): string {
	const field = 'path';
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new FilterValidationError(field, 'expected object of shape {op, value, exclude?}');
	}
	const clause = raw as FilterClause & { exclude?: unknown };
	if (clause.op !== 'in') {
		throw new FilterValidationError(field, 'only op "in" supported on path');
	}
	const includeArr = ensureArray(field, clause.value, MAX_ARRAY_LEN).map((v) =>
		ensureString(field, v)
	);
	const includeExpr = `${field} IN ${renderStringList(field, includeArr)}`;
	if (clause.exclude === undefined) {
		return includeExpr;
	}
	const excludeArr = ensureArray(field, clause.exclude, MAX_ARRAY_LEN).map((v) =>
		ensureString(field, v)
	);
	const excludeExpr = `NOT (${field} IN ${renderStringList(field, excludeArr)})`;
	return `(${includeExpr}) AND ${excludeExpr}`;
}

/**
 * Flatten nested filter objects (e.g. `attachments: { sha256: ... }`) into
 * dotted top-level keys (`attachments.sha256`). Designed so P3 can add the
 * dotted name to FIELD_KINDS without changing the wire format the frontend
 * sends.
 */
function flattenFilters(filters: SearchFilters): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(filters)) {
		if (value === undefined) continue;
		if (
			key === 'attachments' &&
			typeof value === 'object' &&
			value !== null &&
			!Array.isArray(value)
		) {
			for (const [sub, subVal] of Object.entries(value as Record<string, unknown>)) {
				if (subVal === undefined) continue;
				out[`attachments.${sub}`] = subVal;
			}
			continue;
		}
		out[key] = value;
	}
	return out;
}

/**
 * Translate a typed `SearchFilters` object into a Meilisearch filter string.
 *
 * Returns `null` for an empty / undefined input. Throws `FilterValidationError`
 * on any unknown field, disallowed op, or malformed value — the controller
 * maps those to a 400.
 */
export async function translateFilters(
	filters: SearchFilters | undefined
): Promise<string | null> {
	if (!filters || Object.keys(filters).length === 0) {
		return null;
	}

	const flat = flattenFilters(filters);
	if (Object.keys(flat).length === 0) {
		return null;
	}

	const parts: string[] = [];
	for (const [field, raw] of Object.entries(flat)) {
		if (raw === undefined) continue;

		if (field === 'ingestionSourceId') {
			parts.push(await renderIngestionSourceId(raw));
			continue;
		}
		if (field === 'path' && FIELD_KINDS[field]) {
			// Only reachable once P3 adds `path` to FIELD_KINDS.
			parts.push(renderPathClause(raw));
			continue;
		}

		const kind = FIELD_KINDS[field];
		if (!kind) {
			throw new FilterValidationError(field, 'unknown field');
		}
		const clause = normalizeClause(field, raw, kind);
		parts.push(renderClause(field, kind, clause));
	}

	if (parts.length === 0) {
		return null;
	}
	return parts.join(' AND ');
}
