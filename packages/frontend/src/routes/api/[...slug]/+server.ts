import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

const BACKEND_URL = `http://localhost:${env.PORT_BACKEND || 4000}`;

const handleRequest: RequestHandler = async ({ request, params, fetch }) => {
	const url = new URL(request.url);
	const slug = params.slug || '';
	const targetUrl = `${BACKEND_URL}/${slug}${url.search}`;

	try {
		let body: ArrayBuffer | null = null;
		const headers = new Headers(request.headers);

		if (request.method !== 'GET' && request.method !== 'HEAD') {
			body = await request.arrayBuffer();
			if (body.byteLength > 0) {
				headers.set('Content-Length', String(body.byteLength));
			}
		}

		const proxyRequest = new Request(targetUrl, {
			method: request.method,
			headers: headers,
			body: body,
			duplex: 'half',
		} as RequestInit);

		const response = await fetch(proxyRequest);

		return response;
	} catch (error: any) {
		console.error('Proxy request failed:', error);

		// Handle SvelteKit HttpError (e.g. from request.arrayBuffer() exceeding BODY_SIZE_LIMIT)
		// Or other types of errors, formatting them into the standard ApiErrorResponse
		const statusCode = error?.status || 500;
		const message =
			error?.body?.message || error?.message || 'Failed to connect to the backend service.';

		return json(
			{
				status: 'error',
				statusCode: statusCode,
				message: message,
				errors: null,
			},
			{ status: statusCode }
		);
	}
};

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
