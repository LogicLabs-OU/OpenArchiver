import { describe, expect, it } from 'vitest';
import { findByEmailKey, normalizeEmailAddress } from './emailAddress';

describe('normalizeEmailAddress', () => {
	it('lowercases and trims', () => {
		expect(normalizeEmailAddress('  Alice@Example.COM ')).toBe('alice@example.com');
	});

	it('is idempotent', () => {
		const once = normalizeEmailAddress(' Bob@Acme.io ');
		expect(normalizeEmailAddress(once)).toBe(once);
	});

	it('makes two casings of one mailbox compare equal', () => {
		// The property the archive depends on: search (case-insensitive) and
		// permission checks (===) must agree on whether two addresses are the
		// same mailbox.
		expect(normalizeEmailAddress('Legal@Acme.com')).toBe(normalizeEmailAddress('legal@acme.com'));
	});
});

describe('findByEmailKey', () => {
	it('returns undefined for a missing bag', () => {
		expect(findByEmailKey(undefined, 'a@b.com')).toBeUndefined();
	});

	it('finds an exact key', () => {
		expect(findByEmailKey({ 'a@b.com': 'token' }, 'a@b.com')).toBe('token');
	});

	it('finds a key written before addresses were normalized', () => {
		// Providers report mailboxes in whatever casing they were created with, so
		// sync state can hold a mixed-case key from an earlier release.
		expect(findByEmailKey({ 'User@Contoso.COM': 'delta-1' }, 'user@contoso.com')).toBe('delta-1');
	});

	it('looks up a mixed-case address against a normalized key', () => {
		expect(findByEmailKey({ 'user@contoso.com': 'delta-2' }, 'User@Contoso.COM')).toBe('delta-2');
	});

	it('prefers the exact hit over a stale mixed-case entry', () => {
		// Both keys can coexist for one sync cycle; the normalized one must win so
		// the stale token does not resurrect.
		const bag = { 'user@contoso.com': 'fresh', 'User@Contoso.COM': 'stale' };
		expect(findByEmailKey(bag, 'user@contoso.com')).toBe('fresh');
	});

	it('returns undefined when nothing matches', () => {
		expect(findByEmailKey({ 'a@b.com': 1 }, 'c@d.com')).toBeUndefined();
	});

	it('does not treat a falsy stored value as a miss', () => {
		expect(findByEmailKey({ 'a@b.com': 0 }, 'A@B.com')).toBe(0);
	});
});
