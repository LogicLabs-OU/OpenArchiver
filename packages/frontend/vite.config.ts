import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		// This will be 'true' only during the enterprise build process
		'import.meta.env.VITE_ENTERPRISE_MODE': process.env.VITE_ENTERPRISE_MODE === 'true',
	},
	server: {
		host: true,
		port: Number(process.env.PORT_FRONTEND) || 3000,
		// Allow common local dev hostnames and any explicitly configured backend/proxy hosts.
		allowedHosts: (() => {
			const hosts = new Set<string>(['localhost', '127.0.0.1']);
			if (process.env.BACKEND_HOST) {
				for (const h of process.env.BACKEND_HOST.split(',')) {
					const trimmed = h.trim();
					if (trimmed) hosts.add(trimmed);
				}
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
