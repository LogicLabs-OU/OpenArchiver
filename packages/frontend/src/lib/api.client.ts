import { authStore } from '$lib/stores/auth.store';
import { get } from 'svelte/store';

const BASE_URL = '/api/v1'; // Using a relative URL for proxying

const getAccessTokenFromCookie = (): string | null => {
	if (typeof document === 'undefined') {
		return null;
	}

	const tokenCookie = document.cookie
		.split('; ')
		.find((cookie) => cookie.startsWith('accessToken='));

	if (!tokenCookie) {
		return null;
	}

	return decodeURIComponent(tokenCookie.split('=').slice(1).join('='));
};

/**
 * A custom fetch wrapper for the client-side to automatically handle authentication headers.
 * @param url The URL to fetch, relative to the API base.
 * @param options The standard Fetch API options.
 * @returns A Promise that resolves to the Fetch Response.
 */
export const api = async (url: string, options: RequestInit = {}): Promise<Response> => {
	const { accessToken: storeAccessToken } = get(authStore);
	const accessToken = storeAccessToken || getAccessTokenFromCookie();
	const defaultHeaders: HeadersInit = {};

	if (!(options.body instanceof FormData)) {
		defaultHeaders['Content-Type'] = 'application/json';
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

	return fetch(`${BASE_URL}${url}`, mergedOptions);
};
