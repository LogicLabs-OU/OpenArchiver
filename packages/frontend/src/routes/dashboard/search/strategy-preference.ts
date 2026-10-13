import type { MatchingStrategy } from '@open-archiver/types';

/**
 * Remembers the user's preferred matching strategy (#247).
 *
 * Kept in localStorage rather than on the user record: the strategy is a
 * per-browser habit rather than account state, and storing it client-side keeps
 * this to a frontend-only change with no schema or API surface.
 */
const KEY = 'openarchiver.search.matchingStrategy';

const VALID: readonly MatchingStrategy[] = ['last', 'all', 'frequency'];

const isValid = (value: string | null): value is MatchingStrategy =>
	value !== null && (VALID as readonly string[]).includes(value);

/**
 * The saved strategy, or undefined when nothing is saved or the stored value is
 * no longer one this build understands. Safe to call during SSR — returns
 * undefined when there is no window.
 */
export function readStrategyPreference(): MatchingStrategy | undefined {
	if (typeof localStorage === 'undefined') return undefined;
	try {
		const stored = localStorage.getItem(KEY);
		return isValid(stored) ? stored : undefined;
	} catch {
		// Private-mode and storage-disabled browsers throw on access rather than
		// returning null. A missing preference is not an error worth surfacing.
		return undefined;
	}
}

export function writeStrategyPreference(strategy: MatchingStrategy): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(KEY, strategy);
	} catch {
		// Nothing actionable — the preference simply will not persist.
	}
}

export function clearStrategyPreference(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(KEY);
	} catch {
		// As above.
	}
}
