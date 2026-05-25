// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Tests for the search-preferences localStorage shim.
 *
 * The module short-circuits on the server (`browser === false`), so we mock
 * `$app/environment` to flip the flag on. The vitest config defaults to a
 * jsdom environment which would supply a real `localStorage`; we instead run
 * this file under the `node` environment with an explicit in-memory shim so
 * the tests are framework-independent and don't require an extra dev dep.
 *
 * The failure-path tests (storage throws, malformed JSON) install a
 * throwing-shim over `globalThis.localStorage` for the duration of the test
 * and restore the in-memory implementation in `beforeEach`.
 */

vi.mock('$app/environment', () => ({ browser: true }));

import {
	readPrefs,
	writePrefs,
	clearPref,
	PREFS_STORAGE_KEY,
} from './preferences';

// In-memory localStorage shim suitable for the node test environment.
function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		get length() {
			return store.size;
		},
		key(index: number): string | null {
			return Array.from(store.keys())[index] ?? null;
		},
		getItem(key: string): string | null {
			return store.has(key) ? (store.get(key) as string) : null;
		},
		setItem(key: string, value: string): void {
			store.set(key, String(value));
		},
		removeItem(key: string): void {
			store.delete(key);
		},
		clear(): void {
			store.clear();
		},
	};
}

let realStorage: Storage = createMemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
	value: realStorage,
	configurable: true,
	writable: true,
});

beforeEach(() => {
	// Restore a clean in-memory storage between tests so cases don't leak.
	realStorage = createMemoryStorage();
	Object.defineProperty(globalThis, 'localStorage', {
		value: realStorage,
		configurable: true,
		writable: true,
	});
});

afterEach(() => {
	realStorage.clear();
});

describe('readPrefs', () => {
	it('returns {} when nothing is stored', () => {
		expect(readPrefs()).toEqual({});
	});

	it('returns {} when storage holds malformed JSON', () => {
		realStorage.setItem(PREFS_STORAGE_KEY, '{not-json');
		expect(readPrefs()).toEqual({});
	});

	it('returns {} when storage holds a non-object (e.g. array, number)', () => {
		realStorage.setItem(PREFS_STORAGE_KEY, '[1,2,3]');
		expect(readPrefs()).toEqual({});

		realStorage.setItem(PREFS_STORAGE_KEY, '42');
		expect(readPrefs()).toEqual({});
	});

	it('returns {} when getItem throws (private mode shim)', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: () => {
					throw new Error('SecurityError: storage disabled');
				},
				setItem: () => {},
				removeItem: () => {},
				clear: () => {},
			},
			configurable: true,
			writable: true,
		});
		expect(readPrefs()).toEqual({});
	});

	it("ignores unknown matchingStrategy values in stored payload", () => {
		realStorage.setItem(
			PREFS_STORAGE_KEY,
			JSON.stringify({ matchingStrategy: 'bogus' })
		);
		expect(readPrefs()).toEqual({});
	});

	it("ignores defaultSort entries with unknown field/dir", () => {
		realStorage.setItem(
			PREFS_STORAGE_KEY,
			JSON.stringify({
				defaultSort: [{ field: 'fake', dir: 'desc' }],
			})
		);
		expect(readPrefs()).toEqual({});
	});
});

describe('writePrefs', () => {
	it("writePrefs({matchingStrategy:'all'}) then readPrefs() returns that prefs object", () => {
		writePrefs({ matchingStrategy: 'all' });
		expect(readPrefs()).toEqual({ matchingStrategy: 'all' });
	});

	it('second writePrefs merges; does not overwrite an earlier key', () => {
		writePrefs({ matchingStrategy: 'all' });
		writePrefs({ defaultSort: [{ field: 'timestamp', dir: 'desc' }] });
		expect(readPrefs()).toEqual({
			matchingStrategy: 'all',
			defaultSort: [{ field: 'timestamp', dir: 'desc' }],
		});
	});

	it('overwrites a previously-set key when the same patch key is passed again', () => {
		writePrefs({ matchingStrategy: 'all' });
		writePrefs({ matchingStrategy: 'frequency' });
		expect(readPrefs()).toEqual({ matchingStrategy: 'frequency' });
	});

	it('does not throw when localStorage.setItem fails (quota / private mode)', () => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: () => null,
				setItem: () => {
					throw new Error('QuotaExceededError');
				},
				removeItem: () => {},
				clear: () => {},
			},
			configurable: true,
			writable: true,
		});
		expect(() => writePrefs({ matchingStrategy: 'all' })).not.toThrow();
	});
});

describe('clearPref', () => {
	it('removes a single key, leaves others intact', () => {
		writePrefs({ matchingStrategy: 'all' });
		writePrefs({ defaultSort: [{ field: 'timestamp', dir: 'asc' }] });
		clearPref('matchingStrategy');
		expect(readPrefs()).toEqual({
			defaultSort: [{ field: 'timestamp', dir: 'asc' }],
		});
	});

	it('removes the storage entry entirely when no keys remain', () => {
		writePrefs({ matchingStrategy: 'last' });
		clearPref('matchingStrategy');
		expect(realStorage.getItem(PREFS_STORAGE_KEY)).toBeNull();
		expect(readPrefs()).toEqual({});
	});

	it('is a no-op when the key is not stored', () => {
		expect(() => clearPref('defaultSort')).not.toThrow();
		expect(readPrefs()).toEqual({});
	});

	it('does not throw when localStorage.setItem throws during clear-merge', () => {
		writePrefs({ matchingStrategy: 'all' });
		writePrefs({ defaultSort: [{ field: 'timestamp', dir: 'asc' }] });
		// Now swap storage to a throwing one for the merge-write step.
		const merged = realStorage.getItem(PREFS_STORAGE_KEY);
		Object.defineProperty(globalThis, 'localStorage', {
			value: {
				getItem: () => merged,
				setItem: () => {
					throw new Error('QuotaExceededError');
				},
				removeItem: () => {
					throw new Error('SecurityError');
				},
				clear: () => {},
			},
			configurable: true,
			writable: true,
		});
		expect(() => clearPref('matchingStrategy')).not.toThrow();
	});
});

describe('SSR safety', () => {
	it('module exports a public key constant for diagnostics', () => {
		expect(PREFS_STORAGE_KEY).toBe('oa.search.preferences.v1');
	});
});
