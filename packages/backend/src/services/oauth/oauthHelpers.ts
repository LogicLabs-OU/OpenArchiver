import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OAuthMailboxCredentials, OAuthMailboxFlow } from '@open-archiver/types';
import { config } from '../../config';

/**
 * Pure OAuth building blocks for the oauth_mailbox provider: PKCE, the signed state that
 * ties a browser callback to the source that started it, authorization-URL assembly, the
 * device-flow response interpreter, and the credential-merge rules for edits.
 *
 * Deliberately free of database and network access so every rule here can be exercised by
 * a plain script against known vectors.
 */

/** How long an authorization attempt may sit between start and callback. */
export const AUTH_STATE_TTL_MS = 10 * 60 * 1000;

const base64url = (buf: Buffer): string => buf.toString('base64url');

/**
 * RFC 7636 S256 pair. The verifier is 32 random bytes base64url-encoded (43 chars, inside
 * the 43–128 window); the challenge is the base64url SHA-256 of the verifier's ASCII form.
 */
export const generatePkcePair = (): { codeVerifier: string; codeChallenge: string } => {
	const codeVerifier = base64url(randomBytes(32));
	const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
	return { codeVerifier, codeChallenge };
};

/** Derived per call rather than at module load so drills can set the env first. */
const stateKey = (): string => {
	const key = config.app.encryptionKey;
	if (!key) {
		throw new Error('ENCRYPTION_KEY is not set in environment variables.');
	}
	return key;
};

interface StatePayload {
	sourceId: string;
	nonce: string;
	exp: number;
}

/**
 * The OAuth `state` parameter: base64url(JSON payload) + '.' + HMAC-SHA256 signature.
 *
 * The callback route is public — the state is the only thing binding an incoming code to
 * the source that asked for it, so it carries the source id, a nonce that must also match
 * the one stored in the source's encrypted credentials (making states single-use), and an
 * expiry. Keyed with the ENCRYPTION_KEY that already guards the credentials themselves.
 */
export const signState = (sourceId: string, nonce: string, expiresAtEpochMs: number): string => {
	const payload = base64url(
		Buffer.from(JSON.stringify({ sourceId, nonce, exp: expiresAtEpochMs } as StatePayload))
	);
	const signature = createHmac('sha256', stateKey()).update(payload).digest('base64url');
	return `${payload}.${signature}`;
};

/** Null on any defect — bad shape, bad signature, expired — never an exception. */
export const verifyState = (state: string): { sourceId: string; nonce: string } | null => {
	const dot = state.indexOf('.');
	if (dot <= 0 || dot === state.length - 1) {
		return null;
	}
	const payload = state.slice(0, dot);
	const signature = state.slice(dot + 1);
	const expected = createHmac('sha256', stateKey()).update(payload).digest();
	let given: Buffer;
	try {
		given = Buffer.from(signature, 'base64url');
	} catch {
		return null;
	}
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		return null;
	}
	let parsed: StatePayload;
	try {
		parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
	} catch {
		return null;
	}
	if (
		typeof parsed?.sourceId !== 'string' ||
		typeof parsed?.nonce !== 'string' ||
		typeof parsed?.exp !== 'number' ||
		Date.now() > parsed.exp
	) {
		return null;
	}
	return { sourceId: parsed.sourceId, nonce: parsed.nonce };
};

/**
 * The URL the browser is sent to for the auth_code flow. `login_hint` pre-fills the
 * mailbox address and `prompt=select_account` stops a stray already-signed-in account
 * from being silently reused — authorizing the wrong mailbox would archive the wrong
 * person's mail.
 */
export const buildAuthorizationUrl = (
	credentials: OAuthMailboxCredentials,
	redirectUri: string,
	state: string,
	codeChallenge: string
): string => {
	const url = new URL(credentials.authorizationEndpoint);
	url.searchParams.set('client_id', credentials.clientId);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('scope', credentials.scopes);
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('login_hint', credentials.email);
	url.searchParams.set('prompt', 'select_account');
	return url.toString();
};

/** The redirect URI every deployment registers with its provider. */
export const oauthRedirectUri = (): string => `${config.app.publicUrl}/api/v1/oauth/callback`;

export type DeviceTokenOutcome =
	| { kind: 'pending' }
	| { kind: 'slow_down' }
	| { kind: 'success'; accessToken: string; refreshToken?: string; expiresInSeconds: number }
	| { kind: 'expired' }
	| { kind: 'denied' }
	| { kind: 'error'; message: string };

/**
 * Maps one device-flow token response (RFC 8628 §3.5) to what the poll loop should do.
 * Providers answer 400 for the in-progress states, so the status code alone says nothing —
 * the `error` field is the signal.
 */
export const interpretDeviceTokenResponse = (status: number, body: any): DeviceTokenOutcome => {
	if (status === 200 && typeof body?.access_token === 'string') {
		return {
			kind: 'success',
			accessToken: body.access_token,
			refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
			expiresInSeconds: typeof body.expires_in === 'number' ? body.expires_in : 3600,
		};
	}
	switch (body?.error) {
		case 'authorization_pending':
			return { kind: 'pending' };
		case 'slow_down':
			return { kind: 'slow_down' };
		case 'expired_token':
			return { kind: 'expired' };
		case 'access_denied':
			return { kind: 'denied' };
		default:
			return {
				kind: 'error',
				message: String(body?.error_description || body?.error || `HTTP ${status}`),
			};
	}
};

/**
 * The mailbox address a token was issued for, read from the id_token of the same response.
 *
 * The XOAUTH2 exchange sends `user=<address>` alongside the bearer token, and the server
 * matches the two: an address that is not the token's own mailbox is refused with wording
 * that names neither ("User is authenticated but not connected" on Exchange Online). Taking
 * the address from the token itself removes the mismatch, and comparing it with what the
 * admin typed turns "signed in with the wrong account" into something reportable.
 *
 * The signature is deliberately not verified. This id_token was not received from a browser
 * — it came back over TLS from the token endpoint this source is configured with, in direct
 * response to our own request, which is the case OIDC Core 3.1.3.7 exempts from validation.
 * Nothing here grants access either; the claim only decides which mailbox name accompanies a
 * token the provider already scoped.
 *
 * Returns null on anything unexpected, so a provider that omits the id_token, signs a
 * different claim set, or returns something that is not a JWT simply leaves the typed
 * address in charge.
 */
export const readAuthorizedEmail = (idToken: unknown): string | null => {
	if (typeof idToken !== 'string') {
		return null;
	}
	const parts = idToken.split('.');
	if (parts.length !== 3 || !parts[1]) {
		return null;
	}
	let claims: Record<string, unknown>;
	try {
		claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	for (const claim of ['preferred_username', 'email', 'upn'] as const) {
		const value = claims?.[claim];
		if (typeof value === 'string' && value.includes('@')) {
			return value.trim();
		}
	}
	return null;
};

/** The connection fields whose change makes existing tokens meaningless. */
const CONNECTION_FIELDS = [
	'email',
	'clientId',
	'authorizationEndpoint',
	'tokenEndpoint',
	'deviceAuthorizationEndpoint',
	'scopes',
	// Switching between IMAP and Graph switches which resource the token is for, so the
	// stored one cannot serve the new transport even when the scope string looks unchanged.
	'transport',
] as const;

/**
 * Merges an edit's provider config over the stored credentials.
 *
 * The edit dialog cannot show stored credentials (SafeIngestionSource omits them), so what
 * arrives is whatever the admin typed into a blank form. Three rules keep an edit from
 * destroying a working source:
 *
 * - `tokens`, `pendingAuth` and `authorizedEmail` are server-managed: whatever the client
 *   sent for them is discarded and the stored values carried over.
 * - A blank or absent `clientSecret` keeps the stored secret, because a password field can
 *   never be pre-filled.
 * - Changing who or where to authenticate (email, client, endpoints, scopes) invalidates
 *   the tokens — they were granted for the old identity — and the caller must send the
 *   source back to `pending_auth`. Changing only where to fetch mail (imapHost/imapPort)
 *   or cosmetic fields (preset, flow) keeps the tokens.
 */
export const mergeOAuthCredentials = (
	original: OAuthMailboxCredentials,
	incoming: Record<string, any>
): { merged: OAuthMailboxCredentials; connectionChanged: boolean } => {
	const merged: OAuthMailboxCredentials = {
		...original,
		...incoming,
		type: 'oauth_mailbox',
		tokens: original.tokens,
		pendingAuth: original.pendingAuth,
		authorizedEmail: original.authorizedEmail,
	};

	if (typeof incoming.clientSecret !== 'string' || incoming.clientSecret === '') {
		merged.clientSecret = original.clientSecret;
	}

	const connectionChanged = CONNECTION_FIELDS.some((field) => {
		const next = merged[field] ?? '';
		const prev = original[field] ?? '';
		return next !== prev;
	})
		? true
		: // A secret actually replaced (not blank-kept) is also an identity change.
			merged.clientSecret !== original.clientSecret;

	if (connectionChanged) {
		delete merged.tokens;
		delete merged.pendingAuth;
		delete merged.authorizedEmail;
	}

	return { merged, connectionChanged };
};

/** Field-level validation for create and connection-changing edits. */
export const validateOAuthMailboxConfig = (
	cfg: Record<string, any>
): { ok: true } | { ok: false; message: string } => {
	const required = ['email', 'clientId', 'authorizationEndpoint', 'tokenEndpoint', 'scopes'];
	// The IMAP server only has to be named when mail is actually fetched over IMAP; a Graph
	// source reaches the mailbox over HTTPS and has no host to point at.
	if (cfg.transport !== 'graph') {
		required.push('imapHost');
	}
	for (const field of required) {
		if (typeof cfg[field] !== 'string' || cfg[field].trim() === '') {
			return { ok: false, message: `Missing required field: ${field}` };
		}
	}
	const flow: OAuthMailboxFlow = cfg.flow === 'device_code' ? 'device_code' : 'auth_code';
	if (
		flow === 'device_code' &&
		(typeof cfg.deviceAuthorizationEndpoint !== 'string' ||
			cfg.deviceAuthorizationEndpoint.trim() === '')
	) {
		return { ok: false, message: 'Missing required field: deviceAuthorizationEndpoint' };
	}
	for (const endpoint of [
		'authorizationEndpoint',
		'tokenEndpoint',
		'deviceAuthorizationEndpoint',
	]) {
		const value = cfg[endpoint];
		if (
			typeof value === 'string' &&
			value.trim() !== '' &&
			!/^https:\/\//i.test(value.trim())
		) {
			return { ok: false, message: `${endpoint} must be an https:// URL` };
		}
	}
	return { ok: true };
};
