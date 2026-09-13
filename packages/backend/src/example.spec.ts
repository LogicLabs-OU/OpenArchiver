import { describe, it, expect } from 'vitest';

// Smoke test confirming the vitest harness is wired up. Real unit tests live
// alongside the code they cover as *.spec.ts (see vitest.config.ts include).
describe('vitest harness', () => {
	it('runs', () => {
		expect(true).toBe(true);
	});
});
