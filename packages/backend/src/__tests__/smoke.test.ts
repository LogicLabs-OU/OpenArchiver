import { describe, it, expect } from 'vitest';
import { config } from '../config';

describe('backend smoke test', () => {
	it('loads the config module without throwing', () => {
		expect(config).toBeDefined();
	});

	it('does basic arithmetic', () => {
		expect(1 + 1).toBe(2);
	});
});
