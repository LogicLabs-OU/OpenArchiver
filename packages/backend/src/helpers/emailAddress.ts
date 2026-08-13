/**
 * The single definition of "the same mailbox".
 *
 * Three engines decide whether two addresses match and they do not agree on their own: Meilisearch
 * filters ignore letter case and surrounding whitespace, while CASL compares with `===` and Postgres
 * compares byte for byte. Left alone, that gap lets a role find an email in search and then be
 * refused when opening it (issue #439), and lets a provider that changes the casing of a mailbox
 * between syncs archive every message a second time.
 *
 * Applied both when a value is stored and on both sides of every comparison, so addresses already in
 * the archive keep working without being rewritten.
 */
export const normalizeEmailAddress = (value: string): string => value.trim().toLowerCase();

/**
 * Reads a record keyed by mailbox address, tolerating keys written before addresses were
 * normalized — sync state stores a provider's delta/history token under the address the provider
 * reported, and Microsoft returns a user principal name in whatever casing it was created with.
 *
 * The exact hit is tried first, so once a normalized key exists it wins over any stale mixed-case
 * entry left beside it and the scan below goes cold after one sync cycle.
 */
export const findByEmailKey = <T>(
	bag: Record<string, T> | undefined,
	email: string
): T | undefined => {
	if (!bag) return undefined;
	if (bag[email] !== undefined) return bag[email];
	const normalized = normalizeEmailAddress(email);
	return Object.entries(bag).find(([key]) => normalizeEmailAddress(key) === normalized)?.[1];
};
