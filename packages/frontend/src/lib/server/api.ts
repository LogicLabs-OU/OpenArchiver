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
