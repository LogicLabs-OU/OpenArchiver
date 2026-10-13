import type { RequestEvent } from '@sveltejs/kit';
import { accessTokenCookieName } from '$lib/auth-cookie';

const BASE_URL = '/api/v1'; // Using a relative URL for proxying

/**
 * A custom fetch wrapper for the server-side to automatically handle authentication headers.
 * @param url The URL to fetch, relative to the API base.
 * @param event The SvelteKit request event.
 * @param options The standard Fetch API options.
 * @returns A Promise that resolves to the Fetch Response.
 */
export const api = async (
	url: string,
	event: RequestEvent,
	options: RequestInit = {}
): Promise<Response> => {
	const accessToken = event.cookies.get(accessTokenCookieName(event.url.port));

	const defaultHeaders: HeadersInit = {
		'Content-Type': 'application/json',
	};

	// Without this, every server-side call reaches Express from the frontend
	// process's own address, so rate limiters key all users to one loopback
	// bucket and audit entries record 127.0.0.1 instead of the person acting.
	// Prefer the reverse proxy's header from the incoming request; fall back to
	// the socket address. Express runs with `trust proxy` on, so req.ip resolves
	// from this. getClientAddress() throws during prerendering, hence the guard.
	try {
		const clientIp = event.request.headers.get('x-forwarded-for') ?? event.getClientAddress();
		if (clientIp) {
			defaultHeaders['X-Forwarded-For'] = clientIp;
		}
	} catch {
		// Prerender or no address available — the header is simply omitted.
	}

	if (accessToken) {
		defaultHeaders['Authorization'] = `Bearer ${accessToken}`;
	}

	const mergedOptions: RequestInit = {
		...options,
		headers: {
			...defaultHeaders,
			...options.headers,
		},
	};

	return event.fetch(`${BASE_URL}${url}`, mergedOptions);
};
