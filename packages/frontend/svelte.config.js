import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		/**
		 * The built-in cross-origin form check is moved into hooks.server.ts,
		 * where one path can be exempted: /signin/sso/callback/saml, the SAML
		 * assertion consumer. An identity provider completes a login by form-POSTing
		 * the browser there from its own origin, which the blanket check would
		 * refuse with a bare 403 before any hook runs. Every other route keeps
		 * exactly the same protection, applied in the hook instead.
		 */
		csrf: {
			checkOrigin: false,
		},
	},
};

export default config;
