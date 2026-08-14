import type { SyncState } from '@open-archiver/types';

/**
 * One-level deep merge for SyncState.
 *
 * Postgres `jsonb ||` only replaces top-level keys. SyncState looks like
 * `{ google: { [userEmail]: { historyId } } }`, so a shallow merge wipes every
 * other mailbox's historyId. Nested objects are merged; scalars are replaced.
 */
export function oneLevelDeepMergeSyncState(
	existing: SyncState | null | undefined,
	incoming: SyncState
): SyncState {
	const result: Record<string, unknown> = { ...(existing ?? {}) };
	for (const [key, value] of Object.entries(incoming)) {
		const prev = result[key];
		if (
			value !== null &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			prev !== null &&
			typeof prev === 'object' &&
			!Array.isArray(prev)
		) {
			result[key] = { ...(prev as Record<string, unknown>), ...value };
		} else {
			result[key] = value;
		}
	}
	return result as SyncState;
}
