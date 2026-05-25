import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
	plugins: [svelte({ hot: false })],
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts', 'tests/**/*.spec.ts'],
		globals: false,
	},
	resolve: {
		// Ensure the browser entry points are picked up for svelte components.
		conditions: ['browser'],
		alias: {
			$lib: path.resolve(__dirname, 'src/lib'),
			$app: path.resolve(__dirname, '.svelte-kit/runtime/app'),
		},
	},
});
