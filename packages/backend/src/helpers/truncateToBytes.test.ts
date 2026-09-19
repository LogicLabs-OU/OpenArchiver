import { describe, expect, it } from 'vitest';
import { truncateToBytes } from './truncateToBytes';

describe('truncateToBytes', () => {
	it('returns the input unchanged when it already fits', () => {
		expect(truncateToBytes('hello', 100)).toBe('hello');
	});

	it('returns an empty string for a non-positive budget', () => {
		expect(truncateToBytes('hello', 0)).toBe('');
		expect(truncateToBytes('hello', -1)).toBe('');
	});

	it('truncates ASCII to exactly the byte budget', () => {
		expect(truncateToBytes('abcdefghij', 4)).toBe('abcd');
	});

	it('never emits an unpaired surrogate when cutting inside an astral character', () => {
		// '😀' is 4 UTF-8 bytes. Every budget from 1..3 must drop it whole rather
		// than leave half a surrogate pair behind — the failure this helper exists
		// to prevent, because JSON.stringify escapes the lone half and Meilisearch
		// then rejects the entire request.
		for (const budget of [1, 2, 3]) {
			const out = truncateToBytes('😀', budget);
			expect(out).toBe('');
			expect(JSON.stringify(out)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
		}
		expect(truncateToBytes('😀', 4)).toBe('😀');
	});

	it('backs off to a character boundary for multi-byte text', () => {
		// 'é' is 2 bytes: a 3-byte budget keeps one 'é' and drops the partial second.
		expect(truncateToBytes('éé', 3)).toBe('é');
		expect(truncateToBytes('éé', 4)).toBe('éé');
	});

	it('keeps the result within the byte budget for mixed scripts', () => {
		const text = 'aä中😀b'.repeat(20);
		for (const budget of [5, 17, 64, 233]) {
			const out = truncateToBytes(text, budget);
			expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(budget);
			// Round-tripping is lossless only if no character was split.
			expect(Buffer.from(out, 'utf8').toString('utf8')).toBe(out);
		}
	});

	it('handles an empty string', () => {
		expect(truncateToBytes('', 10)).toBe('');
	});
});
