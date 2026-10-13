import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { accessTokenCookieName } from '$lib/auth-cookie';
import { dev } from '$app/environment';
import type { LoginResponse } from '@open-archiver/types';

/**
 * The SAML assertion consumer service (ACS).
 *
 * The identity provider finishes a login by form-POSTing the browser here with
 * a SAMLResponse. A `+server.ts` endpoint rather than a page: the POST arrives
 * from the IdP's origin, and this path is the one exemption from the
 * cross-origin form check in hooks.server.ts. Nothing in the post is trusted as
 * received — the backend validates the response signature against the IdP
 * certificate and consumes the single-use RelayState before any account is
 * touched.
 *
 * On success the session cookie is written with the same attributes as the
 * OIDC callback and the password flow, then the browser is sent to the
 * dashboard with a 303 — the status that turns a POST into a follow-up GET.
 */
export const POST: RequestHandler = async (event) => {
	const { request, url, fetch, cookies } = event;

	let samlResponse: string | null = null;
	let relayState: string | null = null;
	try {
		const form = await request.formData();
		samlResponse = (form.get('SAMLResponse') as string | null) ?? null;
		relayState = (form.get('RelayState') as string | null) ?? null;
	} catch {
		// Not a form post at all; fall through to the missing-parameters exit.
	}

	if (!samlResponse || !relayState) {
		redirect(303, '/signin?ssoError=missing_parameters');
	}

	// Same client-address forwarding the server-side api() helper performs:
	// without it the exchange reaches Express from loopback, which mis-keys the
	// rate limiter and falsifies the audit trail's actorIp.
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	try {
		const clientIp = event.request.headers.get('x-forwarded-for') ?? event.getClientAddress();
		if (clientIp) headers['X-Forwarded-For'] = clientIp;
	} catch {
		// No address available — omit the header.
	}

	let login: LoginResponse;
	try {
		const response = await fetch('/api/v1/enterprise/sso/saml/exchange', {
			method: 'POST',
			headers,
			body: JSON.stringify({ samlResponse, relayState }),
		});

		if (!response.ok) {
			redirect(303, '/signin?ssoError=exchange_failed');
		}

		login = await response.json();
	} catch (error) {
		// SvelteKit redirects are thrown; let them pass.
		if (error && typeof error === 'object' && 'status' in error && 'location' in error) {
			throw error;
		}
		console.error('SAML exchange request failed:', error);
		redirect(303, '/signin?ssoError=exchange_failed');
	}

	cookies.set(accessTokenCookieName(url.port), login.accessToken, {
		path: '/',
		// The token is read by client-side JavaScript, so httpOnly is not an option here.
		httpOnly: false,
		// Lax, not strict: this navigation chain was initiated by the identity
		// provider's origin, and browsers may withhold a Strict cookie on the very
		// redirect that follows — landing the user back on /signin until a manual
		// reload. Lax still keeps the cookie off cross-site POSTs.
		sameSite: 'lax',
		secure: !dev,
		maxAge: 604800,
	});

	redirect(303, '/dashboard');
};
