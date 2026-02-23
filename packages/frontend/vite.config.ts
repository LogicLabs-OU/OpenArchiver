import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import dotenv from 'dotenv';
import path from 'path';

// Load root .env first, then allow a local frontend .env to override it.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		// This will be 'true' only during the enterprise build process
		'import.meta.env.VITE_ENTERPRISE_MODE': process.env.VITE_ENTERPRISE_MODE === 'true',
	},
	server: {
		host: process.env.HOST_FRONTEND || '0.0.0.0',
		port: Number(process.env.PORT_FRONTEND) || 3000,
		// Allow common local dev hostnames and any explicitly configured backend/proxy hosts.
		allowedHosts: (() => {
			if (process.env.DEV_ALLOWED_HOSTS === '*') return true;

			const hosts = new Set<string>(['localhost', '127.0.0.1']);
			const addHostList = (value?: string) => {
				if (!value) return;
				for (const h of value.split(',')) {
					const trimmed = h.trim();
					if (trimmed) hosts.add(trimmed);
				}
			};
			addHostList(process.env.BACKEND_HOST);
			addHostList(process.env.DEV_ALLOWED_HOSTS);
			try {
				if (process.env.APP_URL) {
					const appHost = new URL(process.env.APP_URL).hostname;
					if (appHost) hosts.add(appHost);
				}
			} catch {
				// Ignore invalid APP_URL.
			}
			return Array.from(hosts);
		})(),
		proxy: {
			'/api': {
				target: `http://localhost:${process.env.PORT_BACKEND || 4000}`,
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, ''),
			},
		},
	},
	ssr: {
		noExternal: ['layerchart'],
	},
});
