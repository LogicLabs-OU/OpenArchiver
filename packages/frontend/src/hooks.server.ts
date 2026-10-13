import type { Handle } from '@sveltejs/kit';
import { text } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { jwtVerify } from 'jose';
import type { User } from '@open-archiver/types';
import { accessTokenCookieName } from '$lib/auth-cookie';
import 'dotenv/config';

const JWT_SECRET_ENCODED = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * Paths allowed to receive cross-origin form posts.
 *
 * Exactly one: the SAML assertion consumer, where an identity provider on its
 * own origin form-POSTs the browser to complete a login. That endpoint does not
 * trust the post — the SAMLResponse inside it is signature-checked against the
 * IdP certificate, and its RelayState must match a stored single-use value.
 */
const CROSS_ORIGIN_FORM_ALLOWED = new Set(['/signin/sso/callback/saml']);

const FORM_CONTENT_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
];

const isFormContentType = (request: Request): boolean => {
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
	return FORM_CONTENT_TYPES.includes(type);
};

export const handle: Handle = async ({ event, resolve }) => {
	// SvelteKit's own cross-site form check is disabled in svelte.config.js so the
	// SAML consumer above can exist; this reproduces it for everything else, with
	// the same semantics: production only, mutating methods, form content types.
	if (!dev && !CROSS_ORIGIN_FORM_ALLOWED.has(event.url.pathname)) {
		const { request, url } = event;
		const forbidden =
			['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
			request.headers.get('origin') !== url.origin &&
			isFormContentType(request);
		if (forbidden) {
			return text(`Cross-site ${request.method} form submissions are forbidden`, {
				status: 403,
			});
		}
	}

	const token = event.cookies.get(accessTokenCookieName(event.url.port));

	if (token) {
		try {
			const { payload } = await jwtVerify(token, JWT_SECRET_ENCODED);
			event.locals.user = payload as Omit<User, 'passwordHash'>;
			event.locals.accessToken = token;
		} catch (error) {
			console.error('JWT verification failed:', error);
			event.locals.user = null;
			event.locals.accessToken = null;
		}
	} else {
		event.locals.user = null;
		event.locals.accessToken = null;
	}
	if (import.meta.env.VITE_ENTERPRISE_MODE === true) {
		event.locals.enterpriseMode = true;
	} else {
		event.locals.enterpriseMode = false;
	}

	return resolve(event);
};
