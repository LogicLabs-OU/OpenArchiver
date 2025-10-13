import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

const BACKEND_URL = `http://localhost:${env.PORT_BACKEND || 4000}`;

const handleRequest: RequestHandler = async ({ request, params }) => {
	const url = new URL(request.url);
	const slug = params.slug || '';
	const targetUrl = `${BACKEND_URL}/${slug}${url.search}`;

	// Create headers without the host header to avoid conflicts
	const headers = new Headers(request.headers);
	headers.delete('host');
	headers.delete('connection');

	// Create a new request with the same method, headers, and body
	const proxyRequest = new Request(targetUrl, {
		method: request.method,
		headers: headers,
		body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
		// @ts-ignore - duplex is needed for streaming but not in all TypeScript versions
		duplex: request.body ? 'half' : undefined,
	});

	// Forward the request to the backend
	const response = await fetch(proxyRequest);

	// Return the response from the backend
	return response;
};

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
