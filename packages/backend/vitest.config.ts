import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		globals: false,
		// Stub required env vars before test files load — config modules read
		// these at import time and throw if missing. See test/setup.ts.
		setupFiles: ['./test/setup.ts'],
	},
});
