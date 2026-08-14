import { describe, it, expect } from 'vitest';
import { MAX_GMAIL_RAW_BYTES, rawBase64ExceedsLimit } from '../helpers/gmailLimits';

describe('rawBase64ExceedsLimit', () => {
	it('allows typical email-sized payloads', () => {
		expect(rawBase64ExceedsLimit('A'.repeat(1000))).toBe(false);
	});

	it('rejects payloads that decode above the cap', () => {
		const tooBig = 'A'.repeat(Math.floor((MAX_GMAIL_RAW_BYTES * 4) / 3) + 16);
		expect(rawBase64ExceedsLimit(tooBig)).toBe(true);
	});

	it('respects an explicit max', () => {
		expect(rawBase64ExceedsLimit('AAAA', 1)).toBe(true);
		expect(rawBase64ExceedsLimit('AA', 100)).toBe(false);
	});
});
