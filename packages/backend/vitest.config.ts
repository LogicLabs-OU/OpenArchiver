import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Unit tests run in Node and may touch the real filesystem (temp files),
		// but must not require the live Postgres/Valkey/Meili/Tika services.
		environment: 'node',
		include: ['src/**/*.{test,spec}.ts'],
		// Sets minimal env before the config module graph loads (see file).
		setupFiles: ['./vitest.setup.ts'],
		// Keep the default 5s per-test timeout; these are pure/mocked unit tests.
	},
});
