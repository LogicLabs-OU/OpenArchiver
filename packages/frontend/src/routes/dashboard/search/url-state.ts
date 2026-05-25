/**
 * URL state encoding/decoding for the advanced search filter panel.
 *
 * Pure functions only — no SvelteKit imports. This module is the single
 * source of truth for the URL shape used by `/dashboard/search`.
 *
 * See `docs/plans/advanced-search.md` §2.2 for the binding URL spec.
 *
 * Encoding rules (flat key/value, NOT JSON-in-URL):
 *   q=...                                    keyword query
 *   page=N&limit=N                           pagination
 *   m=last|all|frequency                     matching strategy
 *   sort=<field>:<asc|desc>                  sort clause (single in v1)
 *   f.<short>.op=<op>&f.<short>.v=...        filter clauses (v repeats)
 *   f.path.x=<excluded>                      path-filter exclude entries
 *   f.ts.preset=<preset>                     date preset (preset wins)
 *   f.size.from / f.size.to                  size range (omits null sides)
 *   f.att=1, f.hold=1                        boolean shorthands
 *   f.sha=<hex>                              attachments.sha256 shorthand
 *
 * Empty-filter pruning happens at `toApiSearchQuery` time — encoding keeps
 * draft fidelity so the URL round-trips losslessly.
 */

import {
	startOfDay,
	endOfDay,
	startOfMonth,
	endOfMonth,
	startOfYear,
	endOfYear,
	subDays,
	subMonths,
	subYears,
} from 'date-fns';

import type {
	SearchQuery,
	SearchFilters,
	MatchingStrategy,
	SortClause,
	StringFilter,
	StringArrayFilter,
	TimestampFilter,
	NumberFilter,
	BooleanFilter,
	PathFilter,
	IngestionSourceFilter,
} from '@open-archiver/types';

export type DatePreset =
	| 'today'
	| 'yesterday'
	| 'last-7d'
	| 'last-30d'
	| 'this-month'
	| 'last-month'
	| 'this-year'
	| 'last-year'
	| 'custom';

export interface SearchQueryDraft {
	query: string;
	page: number;
	limit: number;
	matchingStrategy: MatchingStrategy;
	sort: SortClause[];
	filters: Partial<SearchFilters>;
	/**
	 * Special: preserve the user's selected date preset, so e.g. "Last 30 days"
	 * means "last 30 days at request time," not frozen concrete dates.
	 */
	datePreset?: DatePreset;
}

// ---------------------------------------------------------------------------
// Short-key map — single source of truth for URL ↔ canonical name.
// Order matters only for reverse-lookup determinism.
// ---------------------------------------------------------------------------

const FIELD_KEY = {
	from: 'from',
	to: 'to',
	cc: 'cc',
	bcc: 'bcc',
	subject: 'subj',
	ts: 'timestamp',
	src: 'ingestionSourceId',
	mbx: 'userEmail',
	path: 'path',
	att: 'hasAttachments',
	tags: 'tags',
	sha: 'attachments.sha256',
	size: 'sizeBytes',
	hold: 'isOnLegalHold',
} as const;

type ShortKey = keyof typeof FIELD_KEY;
type CanonicalKey = (typeof FIELD_KEY)[ShortKey];

const CANONICAL_TO_SHORT: Record<string, ShortKey> = Object.entries(FIELD_KEY).reduce(
	(acc, [short, canonical]) => {
		acc[canonical] = short as ShortKey;
		return acc;
	},
	{} as Record<string, ShortKey>
);

const SHORT_KEYS = new Set<string>(Object.keys(FIELD_KEY));

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;
const DEFAULT_MATCHING: MatchingStrategy = 'last';

const VALID_MATCHING: ReadonlySet<MatchingStrategy> = new Set<MatchingStrategy>([
	'last',
	'all',
	'frequency',
]);

const VALID_SORT_FIELDS: ReadonlySet<SortClause['field']> = new Set<SortClause['field']>([
	'timestamp',
]);

const VALID_DATE_PRESETS: ReadonlySet<DatePreset> = new Set<DatePreset>([
	'today',
	'yesterday',
	'last-7d',
	'last-30d',
	'this-month',
	'last-month',
	'this-year',
	'last-year',
	'custom',
]);

export function emptyDraft(): SearchQueryDraft {
	return {
		query: '',
		page: DEFAULT_PAGE,
		limit: DEFAULT_LIMIT,
		matchingStrategy: DEFAULT_MATCHING,
		sort: [],
		filters: {},
	};
}

// ---------------------------------------------------------------------------
// hasAnyFilter
// ---------------------------------------------------------------------------

export function hasAnyFilter(draft: SearchQueryDraft): boolean {
	const f = draft.filters ?? {};
	if (draft.datePreset && draft.datePreset !== 'custom') return true;
	for (const key of Object.keys(f) as (keyof SearchFilters)[]) {
		const v = (f as Record<string, unknown>)[key];
		if (v === undefined || v === null) continue;
		if (typeof v === 'boolean') return true;
		if (typeof v === 'object') return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Encode: SearchQueryDraft -> URLSearchParams
// ---------------------------------------------------------------------------

export function encodeSearchParams(draft: SearchQueryDraft): URLSearchParams {
	const params = new URLSearchParams();

	if (draft.query && draft.query.length > 0) {
		params.set('q', draft.query);
	}
	if (typeof draft.page === 'number' && draft.page !== DEFAULT_PAGE) {
		params.set('page', String(draft.page));
	}
	if (typeof draft.limit === 'number' && draft.limit !== DEFAULT_LIMIT) {
		params.set('limit', String(draft.limit));
	}
	if (draft.matchingStrategy && draft.matchingStrategy !== DEFAULT_MATCHING) {
		params.set('m', draft.matchingStrategy);
	}

	// sort[0] only — v1 spec
	if (draft.sort && draft.sort.length > 0) {
		const s = draft.sort[0];
		if (s && VALID_SORT_FIELDS.has(s.field) && (s.dir === 'asc' || s.dir === 'desc')) {
			params.set('sort', `${s.field}:${s.dir}`);
		}
	}

	const filters = draft.filters ?? {};

	encodeStringFilter(params, 'from', filters.from);
	encodeStringArrayFilter(params, 'to', filters.to);
	encodeStringArrayFilter(params, 'cc', filters.cc);
	encodeStringArrayFilter(params, 'bcc', filters.bcc);
	encodeStringFilter(params, 'subj', filters.subject);

	encodeTimestampFilter(params, 'ts', filters.timestamp, draft.datePreset);

	encodeIngestionSourceFilter(params, 'src', filters.ingestionSourceId);
	encodeStringFilter(params, 'mbx', filters.userEmail);

	encodePathFilter(params, 'path', filters.path);

	encodeBooleanShortcut(params, 'att', filters.hasAttachments);

	encodeStringArrayFilter(params, 'tags', filters.tags);

	encodeShaFilter(params, 'sha', filters.attachments?.sha256);

	encodeNumberFilter(params, 'size', filters.sizeBytes);

	encodeBooleanShortcut(params, 'hold', filters.isOnLegalHold);

	return params;
}

function encodeStringFilter(
	params: URLSearchParams,
	short: 'from' | 'subj' | 'mbx',
	f: StringFilter | undefined
): void {
	if (!f) return;
	params.set(`f.${short}.op`, f.op);
	if (f.op === 'in') {
		for (const v of f.value) params.append(`f.${short}.v`, v);
	} else {
		params.set(`f.${short}.v`, f.value);
	}
}

function encodeStringArrayFilter(
	params: URLSearchParams,
	short: 'to' | 'cc' | 'bcc' | 'tags',
	f: StringArrayFilter | undefined
): void {
	if (!f) return;
	params.set(`f.${short}.op`, f.op);
	for (const v of f.value) params.append(`f.${short}.v`, v);
}

function encodeTimestampFilter(
	params: URLSearchParams,
	short: 'ts',
	f: TimestampFilter | undefined,
	preset: DatePreset | undefined
): void {
	// Preset wins. When the preset is non-custom, do NOT echo concrete from/to.
	if (preset && preset !== 'custom') {
		params.set(`f.${short}.preset`, preset);
		return;
	}
	if (preset === 'custom') {
		params.set(`f.${short}.preset`, 'custom');
	}
	if (!f) return;
	params.set(`f.${short}.op`, f.op);
	if (f.op === 'between') {
		params.set(`f.${short}.from`, f.value[0]);
		params.set(`f.${short}.to`, f.value[1]);
	} else {
		params.set(`f.${short}.v`, f.value);
	}
}

function encodeIngestionSourceFilter(
	params: URLSearchParams,
	short: 'src',
	f: IngestionSourceFilter | undefined
): void {
	if (!f) return;
	if (typeof f === 'string') {
		params.set(`f.${short}.op`, 'eq');
		params.set(`f.${short}.v`, f);
		return;
	}
	params.set(`f.${short}.op`, f.op);
	if (f.op === 'in') {
		for (const v of f.value) params.append(`f.${short}.v`, v);
	} else {
		params.set(`f.${short}.v`, f.value);
	}
}

function encodePathFilter(
	params: URLSearchParams,
	short: 'path',
	f: PathFilter | undefined
): void {
	if (!f) return;
	params.set(`f.${short}.op`, f.op);
	for (const v of f.value) params.append(`f.${short}.v`, v);
	if (f.exclude) {
		for (const x of f.exclude) params.append(`f.${short}.x`, x);
	}
}

function encodeBooleanShortcut(
	params: URLSearchParams,
	short: 'att' | 'hold',
	v: BooleanFilter | boolean | undefined
): void {
	if (v === undefined) return;
	const bool = typeof v === 'boolean' ? v : v.value;
	params.set(`f.${short}`, bool ? '1' : '0');
}

function encodeShaFilter(
	params: URLSearchParams,
	short: 'sha',
	f: StringFilter | undefined
): void {
	if (!f) return;
	// SHA is fixed-shape: op=eq, single value.
	if (f.op === 'eq') {
		params.set(`f.${short}`, f.value);
		return;
	}
	// Fallback for non-eq (preserves data, though UI only emits eq).
	params.set(`f.${short}.op`, f.op);
	if (f.op === 'in') {
		for (const v of f.value) params.append(`f.${short}.v`, v);
	} else {
		params.set(`f.${short}.v`, f.value);
	}
}

function encodeNumberFilter(
	params: URLSearchParams,
	short: 'size',
	f: NumberFilter | undefined
): void {
	if (!f) return;
	params.set(`f.${short}.op`, f.op);
	if (f.op === 'between') {
		const [from, to] = f.value;
		if (from !== null && from !== undefined) {
			params.set(`f.${short}.from`, String(from));
		}
		if (to !== null && to !== undefined) {
			params.set(`f.${short}.to`, String(to));
		}
	} else {
		params.set(`f.${short}.v`, String(f.value));
	}
}

// ---------------------------------------------------------------------------
// Decode: URLSearchParams -> SearchQueryDraft
// ---------------------------------------------------------------------------

export function decodeSearchParams(params: URLSearchParams): SearchQueryDraft {
	const draft = emptyDraft();

	const q = params.get('q');
	if (q !== null) draft.query = q;

	const page = parsePositiveInt(params.get('page'));
	if (page !== null) draft.page = page;

	const limit = parsePositiveInt(params.get('limit'));
	if (limit !== null) draft.limit = limit;

	const m = params.get('m');
	if (m && VALID_MATCHING.has(m as MatchingStrategy)) {
		draft.matchingStrategy = m as MatchingStrategy;
	}

	const sortRaw = params.get('sort');
	if (sortRaw) {
		const [field, dir] = sortRaw.split(':');
		if (
			field &&
			VALID_SORT_FIELDS.has(field as SortClause['field']) &&
			(dir === 'asc' || dir === 'desc')
		) {
			draft.sort = [{ field: field as SortClause['field'], dir }];
		}
	}

	const filters: Partial<SearchFilters> = {};

	const fromF = decodeStringFilter(params, 'from');
	if (fromF) filters.from = fromF;

	const toF = decodeStringArrayFilter(params, 'to');
	if (toF) filters.to = toF;

	const ccF = decodeStringArrayFilter(params, 'cc');
	if (ccF) filters.cc = ccF;

	const bccF = decodeStringArrayFilter(params, 'bcc');
	if (bccF) filters.bcc = bccF;

	const subjF = decodeStringFilter(params, 'subj');
	if (subjF) filters.subject = subjF;

	const { filter: tsF, preset } = decodeTimestampFilter(params, 'ts');
	if (tsF) filters.timestamp = tsF;
	if (preset) draft.datePreset = preset;

	const srcF = decodeIngestionSourceFilter(params, 'src');
	if (srcF) filters.ingestionSourceId = srcF;

	const mbxF = decodeStringFilter(params, 'mbx');
	if (mbxF) filters.userEmail = mbxF;

	const pathF = decodePathFilter(params, 'path');
	if (pathF) filters.path = pathF;

	const attF = decodeBooleanShortcut(params, 'att');
	if (attF !== undefined) filters.hasAttachments = attF;

	const tagsF = decodeStringArrayFilter(params, 'tags');
	if (tagsF) filters.tags = tagsF;

	const shaF = decodeShaFilter(params, 'sha');
	if (shaF) filters.attachments = { sha256: shaF };

	const sizeF = decodeNumberFilter(params, 'size');
	if (sizeF) filters.sizeBytes = sizeF;

	const holdF = decodeBooleanShortcut(params, 'hold');
	if (holdF !== undefined) filters.isOnLegalHold = holdF;

	draft.filters = filters;
	return draft;
}

function parsePositiveInt(s: string | null): number | null {
	if (s === null) return null;
	const n = Number.parseInt(s, 10);
	if (!Number.isFinite(n) || n < 1) return null;
	return n;
}

function decodeStringFilter(
	params: URLSearchParams,
	short: 'from' | 'subj' | 'mbx'
): StringFilter | undefined {
	const op = params.get(`f.${short}.op`);
	if (!op) return undefined;
	const values = params.getAll(`f.${short}.v`);
	if (op === 'in') {
		if (values.length === 0) return undefined;
		return { op: 'in', value: values };
	}
	if (op === 'eq' || op === 'contains') {
		if (values.length === 0) return undefined;
		return { op, value: values[0] } as StringFilter;
	}
	return undefined;
}

function decodeStringArrayFilter(
	params: URLSearchParams,
	short: 'to' | 'cc' | 'bcc' | 'tags'
): StringArrayFilter | undefined {
	const op = params.get(`f.${short}.op`);
	if (!op) return undefined;
	const values = params.getAll(`f.${short}.v`);
	if (op !== 'in' && op !== 'any' && op !== 'all') return undefined;
	if (values.length === 0) return undefined;
	return { op, value: values } as StringArrayFilter;
}

function decodeTimestampFilter(
	params: URLSearchParams,
	short: 'ts'
): { filter: TimestampFilter | undefined; preset: DatePreset | undefined } {
	const presetRaw = params.get(`f.${short}.preset`);
	let preset: DatePreset | undefined = undefined;
	if (presetRaw && VALID_DATE_PRESETS.has(presetRaw as DatePreset)) {
		preset = presetRaw as DatePreset;
	}

	// When a non-custom preset is present, ignore any concrete from/to.
	if (preset && preset !== 'custom') {
		return { filter: undefined, preset };
	}

	const op = params.get(`f.${short}.op`);
	if (!op) return { filter: undefined, preset };

	if (op === 'between') {
		const from = params.get(`f.${short}.from`);
		const to = params.get(`f.${short}.to`);
		if (from && to) {
			return { filter: { op: 'between', value: [from, to] }, preset };
		}
		return { filter: undefined, preset };
	}
	if (op === 'eq' || op === 'gte' || op === 'lte') {
		const v = params.get(`f.${short}.v`);
		if (!v) return { filter: undefined, preset };
		return { filter: { op, value: v } as TimestampFilter, preset };
	}
	return { filter: undefined, preset };
}

function decodeIngestionSourceFilter(
	params: URLSearchParams,
	short: 'src'
): IngestionSourceFilter | undefined {
	const op = params.get(`f.${short}.op`);
	if (!op) return undefined;
	const values = params.getAll(`f.${short}.v`);
	if (op === 'in') {
		if (values.length === 0) return undefined;
		return { op: 'in', value: values };
	}
	if (op === 'eq') {
		if (values.length === 0) return undefined;
		return { op: 'eq', value: values[0] };
	}
	return undefined;
}

function decodePathFilter(params: URLSearchParams, short: 'path'): PathFilter | undefined {
	const op = params.get(`f.${short}.op`);
	if (!op || op !== 'in') return undefined;
	const values = params.getAll(`f.${short}.v`);
	if (values.length === 0) return undefined;
	const exclude = params.getAll(`f.${short}.x`);
	const out: PathFilter = { op: 'in', value: values };
	if (exclude.length > 0) out.exclude = exclude;
	return out;
}

function decodeBooleanShortcut(
	params: URLSearchParams,
	short: 'att' | 'hold'
): boolean | undefined {
	const v = params.get(`f.${short}`);
	if (v === null) return undefined;
	if (v === '1' || v === 'true') return true;
	if (v === '0' || v === 'false') return false;
	return undefined;
}

function decodeShaFilter(params: URLSearchParams, short: 'sha'): StringFilter | undefined {
	const flat = params.get(`f.${short}`);
	if (flat) return { op: 'eq', value: flat };
	// Fallback for the verbose form.
	return decodeStringFilter(params, short as never);
}

function decodeNumberFilter(params: URLSearchParams, short: 'size'): NumberFilter | undefined {
	const op = params.get(`f.${short}.op`);
	if (!op) return undefined;
	if (op === 'between') {
		const fromRaw = params.get(`f.${short}.from`);
		const toRaw = params.get(`f.${short}.to`);
		const fromN = fromRaw === null ? null : Number(fromRaw);
		const toN = toRaw === null ? null : Number(toRaw);
		if (
			(fromN !== null && !Number.isFinite(fromN)) ||
			(toN !== null && !Number.isFinite(toN))
		) {
			return undefined;
		}
		if (fromN === null && toN === null) return undefined;
		if (fromN !== null && toN !== null) {
			return { op: 'between', value: [fromN, toN] };
		}
		if (fromN !== null) return { op: 'gte', value: fromN };
		if (toN !== null) return { op: 'lte', value: toN };
		return undefined;
	}
	if (op === 'eq' || op === 'gte' || op === 'lte') {
		const v = params.get(`f.${short}.v`);
		if (v === null) return undefined;
		const n = Number(v);
		if (!Number.isFinite(n)) return undefined;
		return { op, value: n } as NumberFilter;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Draft -> API SearchQuery (with empty-filter pruning + preset resolution)
// ---------------------------------------------------------------------------

export function toApiSearchQuery(draft: SearchQueryDraft): SearchQuery {
	const out: SearchQuery = {};

	const trimmedQuery = (draft.query ?? '').trim();
	if (trimmedQuery.length > 0) out.query = trimmedQuery;

	if (typeof draft.page === 'number' && draft.page > 0) out.page = draft.page;
	if (typeof draft.limit === 'number' && draft.limit > 0) out.limit = draft.limit;
	if (draft.matchingStrategy) out.matchingStrategy = draft.matchingStrategy;
	if (draft.sort && draft.sort.length > 0) {
		out.sort = draft.sort.slice(0, 1);
	}

	const filters = pruneFilters(draft.filters ?? {}, draft.datePreset);
	if (filters && Object.keys(filters).length > 0) {
		out.filters = filters;
	}

	return out;
}

function pruneFilters(
	filters: Partial<SearchFilters>,
	preset: DatePreset | undefined
): SearchFilters | undefined {
	const out: SearchFilters = {};

	// String filters with trim-empty pruning.
	const fromV = pruneStringFilter(filters.from);
	if (fromV) out.from = fromV;

	const subjV = pruneStringFilter(filters.subject);
	if (subjV) out.subject = subjV;

	const mbxV = pruneStringFilter(filters.userEmail);
	if (mbxV) out.userEmail = mbxV;

	// String-array filters: drop when chip list is empty.
	const toV = pruneStringArrayFilter(filters.to);
	if (toV) out.to = toV;

	const ccV = pruneStringArrayFilter(filters.cc);
	if (ccV) out.cc = ccV;

	const bccV = pruneStringArrayFilter(filters.bcc);
	if (bccV) out.bcc = bccV;

	const tagsV = pruneStringArrayTriState(filters.tags);
	if (tagsV) out.tags = tagsV;

	// Path: drop when both include and exclude are empty.
	const pathV = prunePathFilter(filters.path);
	if (pathV) out.path = pathV;

	// Timestamp: resolve preset at call time.
	const tsV = resolveTimestamp(filters.timestamp, preset);
	if (tsV) out.timestamp = tsV;

	// Ingestion source: drop when chip list (or single value) empty.
	const srcV = pruneIngestionSourceFilter(filters.ingestionSourceId);
	if (srcV !== undefined) out.ingestionSourceId = srcV;

	// Booleans: pass through (false is a valid filter value if set explicitly).
	if (filters.hasAttachments !== undefined) {
		out.hasAttachments = filters.hasAttachments;
	}
	if (filters.isOnLegalHold !== undefined) {
		out.isOnLegalHold = filters.isOnLegalHold;
	}

	// attachments.sha256.
	if (filters.attachments?.sha256) {
		const sha = pruneStringFilter(filters.attachments.sha256);
		if (sha) out.attachments = { sha256: sha };
	}

	// sizeBytes: drop when both min and max null/undefined.
	const sizeV = pruneSizeFilter(filters.sizeBytes);
	if (sizeV) out.sizeBytes = sizeV;

	return Object.keys(out).length > 0 ? out : undefined;
}

function pruneStringFilter(f: StringFilter | undefined): StringFilter | undefined {
	if (!f) return undefined;
	if (f.op === 'in') {
		const cleaned = f.value.map((v) => v.trim()).filter((v) => v.length > 0);
		if (cleaned.length === 0) return undefined;
		return { op: 'in', value: cleaned };
	}
	const v = f.value.trim();
	if (v.length === 0) return undefined;
	return { op: f.op, value: v } as StringFilter;
}

function pruneStringArrayFilter(
	f: StringArrayFilter | undefined
): StringArrayFilter | undefined {
	if (!f) return undefined;
	const cleaned = f.value.map((v) => v.trim()).filter((v) => v.length > 0);
	if (cleaned.length === 0) return undefined;
	return { op: f.op, value: cleaned } as StringArrayFilter;
}

/**
 * Tri-state array filter: prune both the empty value list and the 'any'
 * sentinel-only state (per sub-plan §4: tri-state 'any' → omit unless paired
 * with chips). Here we treat "any with no chips" as empty.
 */
function pruneStringArrayTriState(
	f: StringArrayFilter | undefined
): StringArrayFilter | undefined {
	return pruneStringArrayFilter(f);
}

function prunePathFilter(f: PathFilter | undefined): PathFilter | undefined {
	if (!f) return undefined;
	const include = f.value.map((v) => v.trim()).filter((v) => v.length > 0);
	const exclude = (f.exclude ?? []).map((v) => v.trim()).filter((v) => v.length > 0);
	if (include.length === 0 && exclude.length === 0) return undefined;
	if (include.length === 0) {
		// Exclude-only is still a valid filter (rendered as NOT IN by translator).
		return { op: 'in', value: [], exclude };
	}
	const out: PathFilter = { op: 'in', value: include };
	if (exclude.length > 0) out.exclude = exclude;
	return out;
}

function pruneIngestionSourceFilter(
	f: IngestionSourceFilter | undefined
): IngestionSourceFilter | undefined {
	if (!f) return undefined;
	if (typeof f === 'string') {
		const v = f.trim();
		return v.length > 0 ? v : undefined;
	}
	if (f.op === 'in') {
		const cleaned = f.value.filter((v) => v && v.length > 0);
		if (cleaned.length === 0) return undefined;
		return { op: 'in', value: cleaned };
	}
	if (f.op === 'eq') {
		if (!f.value) return undefined;
		return { op: 'eq', value: f.value };
	}
	return undefined;
}

function pruneSizeFilter(f: NumberFilter | undefined): NumberFilter | undefined {
	if (!f) return undefined;
	if (f.op === 'between') {
		const [from, to] = f.value;
		const fromOk = typeof from === 'number' && Number.isFinite(from);
		const toOk = typeof to === 'number' && Number.isFinite(to);
		if (!fromOk && !toOk) return undefined;
		if (fromOk && toOk) return { op: 'between', value: [from, to] };
		if (fromOk) return { op: 'gte', value: from };
		return { op: 'lte', value: to };
	}
	if (typeof f.value === 'number' && Number.isFinite(f.value)) {
		return f;
	}
	return undefined;
}

function resolveTimestamp(
	explicit: TimestampFilter | undefined,
	preset: DatePreset | undefined
): TimestampFilter | undefined {
	if (preset && preset !== 'custom') {
		const range = computePresetRange(preset, new Date());
		if (!range) return undefined;
		return { op: 'between', value: [range.from, range.to] };
	}
	if (!explicit) return undefined;
	if (explicit.op === 'between') {
		const [from, to] = explicit.value;
		if (!from || !to) return undefined;
		return explicit;
	}
	if (!explicit.value) return undefined;
	return explicit;
}

function computePresetRange(
	preset: Exclude<DatePreset, 'custom'>,
	now: Date
): { from: string; to: string } | null {
	let from: Date;
	let to: Date;
	switch (preset) {
		case 'today':
			from = startOfDay(now);
			to = endOfDay(now);
			break;
		case 'yesterday': {
			const y = subDays(now, 1);
			from = startOfDay(y);
			to = endOfDay(y);
			break;
		}
		case 'last-7d':
			from = startOfDay(subDays(now, 6));
			to = endOfDay(now);
			break;
		case 'last-30d':
			from = startOfDay(subDays(now, 29));
			to = endOfDay(now);
			break;
		case 'this-month':
			from = startOfMonth(now);
			to = endOfMonth(now);
			break;
		case 'last-month': {
			const m = subMonths(now, 1);
			from = startOfMonth(m);
			to = endOfMonth(m);
			break;
		}
		case 'this-year':
			from = startOfYear(now);
			to = endOfYear(now);
			break;
		case 'last-year': {
			const y = subYears(now, 1);
			from = startOfYear(y);
			to = endOfYear(y);
			break;
		}
		default:
			return null;
	}
	return { from: from.toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------------------
// API SearchQuery -> draft (inverse of toApiSearchQuery, minus preset)
// ---------------------------------------------------------------------------

export function fromApiSearchQuery(q: SearchQuery): SearchQueryDraft {
	const draft = emptyDraft();
	if (typeof q.query === 'string') draft.query = q.query;
	if (typeof q.page === 'number') draft.page = q.page;
	if (typeof q.limit === 'number') draft.limit = q.limit;
	if (q.matchingStrategy && VALID_MATCHING.has(q.matchingStrategy)) {
		draft.matchingStrategy = q.matchingStrategy;
	}
	if (Array.isArray(q.sort)) {
		draft.sort = q.sort
			.filter(
				(s) =>
					s &&
					VALID_SORT_FIELDS.has(s.field) &&
					(s.dir === 'asc' || s.dir === 'desc')
			)
			.slice(0, 1);
	}
	if (q.filters && typeof q.filters === 'object') {
		draft.filters = { ...q.filters };
	}
	return draft;
}

// ---------------------------------------------------------------------------
// Re-exports used by callers that want to consult the short-key map
// (e.g. for diagnostics or "Source no longer available" detection).
// ---------------------------------------------------------------------------

export { FIELD_KEY, CANONICAL_TO_SHORT, SHORT_KEYS };
export type { ShortKey, CanonicalKey };
