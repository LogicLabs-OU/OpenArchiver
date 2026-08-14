import type { INetworkModule, NetworkRequestOptions, NetworkResponse } from '@azure/msal-node';
import { REQUEST_TIMEOUT_MS } from './retry';

/**
 * The network client MSAL uses for token acquisition, with a deadline attached.
 *
 * MSAL's own client applies its `timeout` argument to GET requests only — `sendPostRequestAsync`
 * neither sets `options.timeout` nor listens for the socket's `timeout` event, so it never destroys
 * a stalled request. Token acquisition is a POST, which left it as the one unbounded await in the
 * mailbox path: `acquireTokenByClientCredential` is called on every Graph request whose token has
 * expired, and a login endpoint that accepts the connection and then goes quiet would park the job
 * forever. Nothing upstream notices — BullMQ renews the job's lock while its promise is pending and
 * the session heartbeat keeps ticking — so the source sits in 'syncing' and the scheduler, which
 * admits only 'active' and 'error', never picks it up again.
 *
 * `HttpClient` is not part of msal-node's public surface, so this cannot wrap it and instead talks
 * to `fetch` directly. The response shape and the non-JSON fallback below mirror what MSAL's client
 * returns, because MSAL reads `body.error` and `body.error_description` off the result rather than
 * inspecting the status alone.
 */
export class TimeboundMsalNetworkClient implements INetworkModule {
	public async sendGetRequestAsync<T>(
		url: string,
		options?: NetworkRequestOptions,
		timeout?: number
	): Promise<NetworkResponse<T>> {
		// MSAL passes its own timeout for region discovery, which is deliberately short. Honoured
		// when it does, so that call is not stretched to the full mailbox-request deadline.
		return this.send<T>(url, 'GET', options, timeout ?? REQUEST_TIMEOUT_MS);
	}

	public async sendPostRequestAsync<T>(
		url: string,
		options?: NetworkRequestOptions
	): Promise<NetworkResponse<T>> {
		return this.send<T>(url, 'POST', options, REQUEST_TIMEOUT_MS);
	}

	private async send<T>(
		url: string,
		method: 'GET' | 'POST',
		options: NetworkRequestOptions | undefined,
		timeoutMs: number
	): Promise<NetworkResponse<T>> {
		const response = await fetch(url, {
			method,
			headers: options?.headers,
			body: method === 'POST' ? options?.body : undefined,
			signal: AbortSignal.timeout(timeoutMs),
		});

		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			headers[key] = value;
		});

		return {
			headers,
			body: parseBody<T>(
				await response.text(),
				response.status,
				response.statusText,
				headers
			),
			status: response.status,
		};
	}
}

/**
 * MSAL's own fallback for a body that is not JSON — a proxy's HTML error page, most often. Kept
 * because MSAL surfaces `error_description` to the caller, so dropping it would turn a legible
 * failure into an empty one.
 */
const parseBody = <T>(
	body: string,
	status: number,
	statusMessage: string,
	headers: Record<string, string>
): T => {
	try {
		return JSON.parse(body) as T;
	} catch {
		const [errorType, helper] =
			status >= 400 && status <= 499
				? ['client_error', 'A client']
				: status >= 500 && status <= 599
					? ['server_error', 'A server']
					: ['unknown_error', 'An unknown'];

		return {
			error: errorType,
			error_description: `${helper} error occured.\nHttp status code: ${status}\nHttp status message: ${statusMessage || 'Unknown'}\nHeaders: ${JSON.stringify(headers)}`,
		} as T;
	}
};
