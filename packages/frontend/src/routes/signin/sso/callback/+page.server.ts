import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { api } from '$lib/server/api';
import { accessTokenCookieName } from '$lib/auth-cookie';
import { dev } from '$app/environment';
import type { LoginResponse } from '@open-archiver/types';

/**
 * Where the identity provider sends the browser back to.
 *
 * This is a frontend URL rather than a backend one, so a deployment never has to
 * expose the Express port to reach it. The authorization code is exchanged
 * server-side from here, so it never passes through client-side JavaScript.
 *
 * The session cookie is written with exactly the attributes `authStore.login()`
 * uses for a password login, so every existing session path — the hook that reads
 * it, the layout that syncs the store, the logout that clears it — works on an SSO
 * session without knowing one exists.
 */
export const load: PageServerLoad = async (event) => {
	const { url } = event;

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	// The identity provider reports a refusal in the query string rather than by
	// withholding the code, so check for it before anything else.
	const idpError = url.searchParams.get('error');
	if (idpError) {
		redirect(302, `/signin?ssoError=${encodeURIComponent(idpError)}`);
	}

	if (!code || !state) {
		redirect(302, '/signin?ssoError=missing_parameters');
	}

	let login: LoginResponse;
	try {
		const response = await api('/enterprise/sso/oidc/exchange', event, {
			method: 'POST',
			body: JSON.stringify({
				code,
				state,
				...(url.searchParams.get('iss') ? { iss: url.searchParams.get('iss') } : {}),
			}),
		});

		if (!response.ok) {
			redirect(302, '/signin?ssoError=exchange_failed');
		}

		login = await response.json();
	} catch (error) {
		// A redirect is thrown, so let it through rather than turning it into an error.
		if (error && typeof error === 'object' && 'status' in error && 'location' in error) {
			throw error;
		}
		console.error('SSO exchange request failed:', error);
		redirect(302, '/signin?ssoError=exchange_failed');
	}

	event.cookies.set(accessTokenCookieName(url.port), login.accessToken, {
		path: '/',
		// The token is read from JavaScript on the client, so it cannot be httpOnly
		// here without breaking every client-side API call.
		httpOnly: false,
		// Lax, not strict: the redirect chain that lands here was initiated by the
		// identity provider's origin, and browsers may withhold a Strict cookie on
		// the /dashboard request that follows — the user would bounce to /signin
		// and only get in on a manual reload. Lax still refuses cross-site POSTs.
		sameSite: 'lax',
		secure: !dev,
		maxAge: 604800,
	});

	// A fixed destination. Without a `returnTo` parameter there is nothing for an
	// attacker to point somewhere else.
	redirect(302, '/dashboard');
};
