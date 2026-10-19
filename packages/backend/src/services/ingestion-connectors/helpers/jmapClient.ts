import { REQUEST_TIMEOUT_MS } from './retry';

/**
 * The few parts of JMAP (RFC 8620 core, RFC 8621 mail) an archiver needs: the session, method
 * calls, and raw blob downloads.
 *
 * Written against `fetch` rather than taken from a library because the published clients only
 * support Bearer tokens, and Stalwart's app passwords need HTTP Basic. Three request shapes do not
 * justify a dependency.
 */

const CORE = 'urn:ietf:params:jmap:core';
const MAIL = 'urn:ietf:params:jmap:mail';

/** A failure that carries the HTTP status, so the shared retry helper can judge it. */
export class JmapError extends Error {
	constructor(
		message: string,
		public readonly status?: number
	) {
		super(message);
		this.name = 'JmapError';
	}
}

/** The server refused the credential. Retrying cannot help. */
export class JmapAuthError extends JmapError {
	constructor(status: number) {
		super(`JMAP authentication failed (HTTP ${status}). Check the token or password.`, status);
		this.name = 'JmapAuthError';
	}
}

/** A method call answered with an `error` response (RFC 8620 §3.6.2). */
export class JmapMethodError extends JmapError {
	constructor(
		public readonly type: string,
		description?: string
	) {
		super(`JMAP method error: ${type}${description ? ` (${description})` : ''}`);
		this.name = 'JmapMethodError';
	}
}

/** The blob is gone: the message was deleted between being listed and being downloaded. */
export class JmapBlobMissingError extends JmapError {
	constructor(blobId: string) {
		super(`JMAP blob ${blobId} not found`, 404);
		this.name = 'JmapBlobMissingError';
	}
}

export interface JmapSession {
	apiUrl: string;
	downloadUrl: string;
	accountId: string;
	maxObjectsInGet: number;
}

/** One method call: `[name, arguments, callId]`. */
export type JmapInvocation = [string, Record<string, unknown>, string];

export class JmapClient {
	readonly #serverUrl: string;
	readonly #authorization: string;
	readonly #fetch: typeof fetch;
	#session: JmapSession | null = null;

	constructor(options: { serverUrl: string; authorization: string; fetchImpl?: typeof fetch }) {
		this.#serverUrl = options.serverUrl.trim();
		this.#authorization = options.authorization;
		this.#fetch = options.fetchImpl ?? fetch;
	}

	async #request(url: string, init: RequestInit = {}): Promise<Response> {
		const response = await this.#fetch(url, {
			...init,
			headers: { Authorization: this.#authorization, ...init.headers },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (response.status === 401 || response.status === 403) {
			throw new JmapAuthError(response.status);
		}
		return response;
	}

	/**
	 * Reads the session from `/.well-known/jmap` (RFC 8620 §2.2), once per client. Fastmail answers
	 * with a redirect to its session path, which `fetch` follows; the URLs inside the session are
	 * absolute, so nothing else depends on where it was found.
	 */
	public async session(): Promise<JmapSession> {
		if (this.#session) {
			return this.#session;
		}
		// Well-known paths live at the origin root (RFC 8615), so a pasted session URL still works.
		const response = await this.#request(new URL('/.well-known/jmap', this.#serverUrl).href);
		if (!response.ok) {
			throw new JmapError(
				`Could not read the JMAP session from ${this.#serverUrl} (HTTP ${response.status})`,
				response.status
			);
		}
		const body = (await response.json()) as Record<string, any>;
		const accountId = body.primaryAccounts?.[MAIL];
		if (!body.capabilities?.[MAIL] || typeof accountId !== 'string') {
			throw new JmapError('The JMAP server does not offer mail for this account.');
		}
		this.#session = {
			apiUrl: body.apiUrl,
			downloadUrl: body.downloadUrl,
			accountId,
			maxObjectsInGet: Number(body.capabilities?.[CORE]?.maxObjectsInGet) || 500,
		};
		return this.#session;
	}

	/**
	 * Sends method calls in one request and returns each call's arguments, by call id. A call the
	 * server answered with an `error` throws, since every caller here needs all of its answers.
	 */
	public async call(methodCalls: JmapInvocation[]): Promise<Record<string, Record<string, any>>> {
		const session = await this.session();
		const response = await this.#request(session.apiUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ using: [CORE, MAIL], methodCalls }),
		});
		if (!response.ok) {
			throw new JmapError(`JMAP request failed (HTTP ${response.status})`, response.status);
		}
		const body = (await response.json()) as { methodResponses?: JmapInvocation[] };
		const results: Record<string, Record<string, any>> = {};
		for (const [name, args, callId] of body.methodResponses ?? []) {
			if (name === 'error') {
				throw new JmapMethodError(String(args.type), args.description as string);
			}
			results[callId] = args;
		}
		return results;
	}

	/**
	 * Downloads a blob as raw bytes. For an Email's `blobId` that is the message exactly as stored
	 * (RFC 8621 §4.1.1); body-part blobs are decoded and must not be used for archiving.
	 */
	public async downloadBlob(blobId: string, name: string): Promise<Buffer> {
		const session = await this.session();
		const url = session.downloadUrl
			.replace('{accountId}', encodeURIComponent(session.accountId))
			.replace('{blobId}', encodeURIComponent(blobId))
			.replace('{type}', encodeURIComponent('message/rfc822'))
			.replace('{name}', encodeURIComponent(name));
		const response = await this.#request(url);
		if (response.status === 404) {
			throw new JmapBlobMissingError(blobId);
		}
		if (!response.ok) {
			throw new JmapError(`JMAP download failed (HTTP ${response.status})`, response.status);
		}
		return Buffer.from(await response.arrayBuffer());
	}
}
