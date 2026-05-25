// TODO(P6-migrate): when the umbrella ships a DB-backed `userPreferences`
// table, replace this localStorage shim. The contract stays the same (read,
// write, clear of a typed `SearchPrefs` object); only the backing store
// changes. Migration plan: on first server-side read, hydrate the DB row from
// any localStorage value present in the browser; thereafter the DB row is
// canonical and localStorage is best-effort cache.

import { browser } from '$app/environment';
import type { MatchingStrategy, SortClause } from '@open-archiver/types';

const KEY = 'oa.search.preferences.v1';

export interface SearchPrefs {
	matchingStrategy?: MatchingStrategy;
	defaultSort?: SortClause[];
}

/**
 * Read all stored search preferences. Returns `{}` when:
 *  - running on the server (SSR),
 *  - localStorage access throws (private mode / quota / disabled),
 *  - the stored payload is missing or malformed JSON,
 *  - the stored payload is not a plain object.
 *
 * Never throws.
 */
export function readPrefs(): SearchPrefs {
	if (!browser) return {};
	let raw: string | null;
	try {
		raw = globalThis.localStorage?.getItem(KEY) ?? null;
	} catch {
		return {};
	}
	if (!raw) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {};
	}
	return sanitize(parsed as Record<string, unknown>);
}

/**
 * Merge `patch` into the stored prefs and persist. No-op on the server, or
 * when localStorage throws (private mode / quota exceeded).
 *
 * Pass `undefined` for any field to leave it untouched. Use `clearPref` to
 * actively remove a key.
 */
export function writePrefs(patch: Partial<SearchPrefs>): void {
	if (!browser) return;
	const current = readPrefs();
	const merged: SearchPrefs = { ...current };
	if (patch.matchingStrategy !== undefined) {
		merged.matchingStrategy = patch.matchingStrategy;
	}
	if (patch.defaultSort !== undefined) {
		merged.defaultSort = patch.defaultSort;
	}
	try {
		globalThis.localStorage?.setItem(KEY, JSON.stringify(merged));
	} catch {
		// Quota exceeded / disabled storage — silently drop.
	}
}

/**
 * Remove a single preference key. No-op on the server or on storage errors.
 */
export function clearPref<K extends keyof SearchPrefs>(key: K): void {
	if (!browser) return;
	const current = readPrefs();
	if (!(key in current)) return;
	const next: SearchPrefs = { ...current };
	delete next[key];
	try {
		if (Object.keys(next).length === 0) {
			globalThis.localStorage?.removeItem(KEY);
		} else {
			globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
		}
	} catch {
		// Silently drop.
	}
}

// ---------------------------------------------------------------------------
// Internal: defensive validation of stored payload shape
// ---------------------------------------------------------------------------

const VALID_MATCHING: ReadonlySet<MatchingStrategy> = new Set<MatchingStrategy>([
	'last',
	'all',
	'frequency',
]);

function sanitize(obj: Record<string, unknown>): SearchPrefs {
	const out: SearchPrefs = {};
	const m = obj.matchingStrategy;
	if (typeof m === 'string' && VALID_MATCHING.has(m as MatchingStrategy)) {
		out.matchingStrategy = m as MatchingStrategy;
	}
	const s = obj.defaultSort;
	if (Array.isArray(s)) {
		const cleaned = s.filter(isSortClause);
		if (cleaned.length > 0) out.defaultSort = cleaned;
	}
	return out;
}

function isSortClause(v: unknown): v is SortClause {
	if (!v || typeof v !== 'object') return false;
	const c = v as Record<string, unknown>;
	return c.field === 'timestamp' && (c.dir === 'asc' || c.dir === 'desc');
}

// Exposed for tests that want to assert the storage key shape.
export const PREFS_STORAGE_KEY = KEY;
