import { describe, it, expect } from 'vitest';
import { cn } from '$lib/utils';

describe('frontend smoke test', () => {
	it('loads the cn helper from $lib/utils', () => {
		expect(typeof cn).toBe('function');
	});

	it('asserts a trivial truth', () => {
		expect(true).toBe(true);
	});
});
