import { randomBytes } from 'node:crypto';
import type {
	OAuthAuthorizeResponse,
	OAuthMailboxCredentials,
	OAuthMailboxFlow,
	OAuthPollResponse,
} from '@open-archiver/types';
import { IngestionService } from '../IngestionService';
import { OAuthTokenService } from './OAuthTokenService';
import {
	AUTH_STATE_TTL_MS,
	buildAuthorizationUrl,
	generatePkcePair,
	interpretDeviceTokenResponse,
	oauthRedirectUri,
	readAuthorizedEmail,
	signState,
	verifyState,
} from './oauthHelpers';
import { EmailProviderFactory } from '../EmailProviderFactory';
import { logger } from '../../config/logger';

/** Clock-skew allowance subtracted from the provider's expires_in when storing. */
const EXPIRY_SKEW_MS = 60 * 1000;

export interface CallbackResult {
	ok: boolean;
	sourceId?: string;
	message?: string;
}

/**
 * Orchestrates the two authorization flows of the oauth_mailbox provider. All transient
 * flow state — the PKCE verifier, the state nonce, the device code — lives inside the
 * source's encrypted credentials column, so there is no side table and nothing to clean
 * up: an abandoned attempt is just a pending_auth source whose Re-authorize starts over.
 *
 * May import IngestionService (unlike OAuthTokenService): the auth_success transition has
 * to go through IngestionService.update because that is what triggers the initial import.
 */
export class OAuthMailboxService {
	/**
	 * Starts (or restarts) an authorization. One entry point serves the first-time flow
	 * and the Re-authorize action — the only difference is what status the source is in,
	 * and that is deliberately left alone here: it flips only on success.
	 */
	public static async startAuthorization(
		sourceId: string,
		flowOverride?: OAuthMailboxFlow
	): Promise<OAuthAuthorizeResponse> {
		const credentials = await OAuthTokenService.loadCredentials(sourceId);
		const flow = flowOverride ?? credentials.flow;

		if (flow === 'device_code') {
			return this.startDeviceFlow(sourceId, credentials);
		}
		return this.startAuthCodeFlow(sourceId, credentials);
	}

	static async startAuthCodeFlow(
		sourceId: string,
		credentials: OAuthMailboxCredentials
	): Promise<OAuthAuthorizeResponse> {
		const { codeVerifier, codeChallenge } = generatePkcePair();
		const nonce = randomBytes(16).toString('base64url');
		const expiresAtMs = Date.now() + AUTH_STATE_TTL_MS;

		await OAuthTokenService.persistTokens(sourceId, {
			...credentials,
			pendingAuth: {
				flow: 'auth_code',
				codeVerifier,
				stateNonce: nonce,
				expiresAt: new Date(expiresAtMs).toISOString(),
			},
		});

		const state = signState(sourceId, nonce, expiresAtMs);
		return {
			flow: 'auth_code',
			authorizationUrl: buildAuthorizationUrl(
				credentials,
				oauthRedirectUri(),
				state,
				codeChallenge
			),
		};
	}

	static async startDeviceFlow(
		sourceId: string,
		credentials: OAuthMailboxCredentials,
		fetchImpl: typeof fetch = fetch
	): Promise<OAuthAuthorizeResponse> {
		if (!credentials.deviceAuthorizationEndpoint) {
			throw new Error('This source has no device authorization endpoint configured.');
		}

		const body = new URLSearchParams({
			client_id: credentials.clientId,
			scope: credentials.scopes,
		});
		const response = await fetchImpl(credentials.deviceAuthorizationEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
			signal: AbortSignal.timeout(30_000),
		});
		const payload: any = await response.json().catch(() => ({}));
		if (response.status !== 200 || typeof payload?.device_code !== 'string') {
			throw new Error(
				`Device authorization request failed (${response.status}): ${payload?.error_description || payload?.error || 'unknown error'}`
			);
		}

		const expiresIn = Number(payload.expires_in) || 900;
		const interval = Number(payload.interval) || 5;

		await OAuthTokenService.persistTokens(sourceId, {
			...credentials,
			pendingAuth: {
				flow: 'device_code',
				deviceCode: payload.device_code,
				userCode: payload.user_code,
				verificationUri: payload.verification_uri || payload.verification_url,
				verificationUriComplete: payload.verification_uri_complete,
				interval,
				expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
			},
		});

		// The device_code stays server-side: it plus the client_id is all anyone needs to
		// poll the token endpoint, so only the user-facing fields leave this process.
		return {
			flow: 'device_code',
			userCode: payload.user_code,
			verificationUri: payload.verification_uri || payload.verification_url,
			verificationUriComplete: payload.verification_uri_complete,
			expiresIn,
			interval,
		};
	}

	/**
	 * The browser callback of the auth_code flow. The state signature names a source; the
	 * nonce stored in that source's credentials must ALSO match, which makes each state
	 * single-use — completing an authorization clears pendingAuth, so a replayed callback
	 * finds no nonce and dies without a single write.
	 */
	public static async handleCallback(
		stateParam: string,
		code?: string,
		errorParam?: string,
		errorDescription?: string,
		fetchImpl: typeof fetch = fetch
	): Promise<CallbackResult> {
		const state = stateParam ? verifyState(stateParam) : null;
		if (!state) {
			return { ok: false, message: 'Invalid or expired authorization state.' };
		}

		let credentials: OAuthMailboxCredentials;
		try {
			credentials = await OAuthTokenService.loadCredentials(state.sourceId);
		} catch {
			return { ok: false, message: 'Invalid or expired authorization state.' };
		}

		const pending = credentials.pendingAuth;
		if (
			pending?.flow !== 'auth_code' ||
			!pending.stateNonce ||
			pending.stateNonce !== state.nonce ||
			new Date(pending.expiresAt).getTime() < Date.now()
		) {
			return { ok: false, message: 'Invalid or expired authorization state.' };
		}

		if (errorParam || !code) {
			// The user denied consent, or the provider reported a failure. Clear the
			// attempt so the state cannot be retried against a half-open flow.
			const { pendingAuth: _dropped, ...rest } = credentials;
			await OAuthTokenService.persistTokens(state.sourceId, rest);
			const message = errorDescription || errorParam || 'Authorization was not completed.';
			await IngestionService.update(state.sourceId, { lastSyncStatusMessage: message });
			return { ok: false, sourceId: state.sourceId, message };
		}

		const body = new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: credentials.clientId,
			code,
			redirect_uri: oauthRedirectUri(),
			code_verifier: pending.codeVerifier ?? '',
			scope: credentials.scopes,
		});
		if (credentials.clientSecret) {
			body.set('client_secret', credentials.clientSecret);
		}

		let status: number;
		let payload: any;
		try {
			const response = await fetchImpl(credentials.tokenEndpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: body.toString(),
				signal: AbortSignal.timeout(30_000),
			});
			status = response.status;
			payload = await response.json().catch(() => ({}));
		} catch (error) {
			const message = `Could not reach the token endpoint: ${
				error instanceof Error ? error.message : String(error)
			}`;
			await IngestionService.update(state.sourceId, { lastSyncStatusMessage: message });
			return { ok: false, sourceId: state.sourceId, message };
		}

		if (status !== 200 || typeof payload?.access_token !== 'string') {
			const message = `Token exchange failed (${status}): ${payload?.error_description || payload?.error || 'unknown error'}`;
			logger.warn({ sourceId: state.sourceId, status, error: payload?.error }, message);
			await IngestionService.update(state.sourceId, { lastSyncStatusMessage: message });
			return { ok: false, sourceId: state.sourceId, message };
		}

		const completion = await this.completeAuthorization(state.sourceId, credentials, payload);
		return { ok: completion.ok, sourceId: state.sourceId, message: completion.message };
	}

	/**
	 * One step of the frontend-driven device-code poll. The loop lives in the browser —
	 * the admin is sitting on the dialog anyway, a held-open HTTP request would tie up a
	 * connection for minutes, and a background job would add cross-process claiming for
	 * nothing. An abandoned poll leaves an inert pending_auth source.
	 */
	public static async pollDeviceFlow(
		sourceId: string,
		fetchImpl: typeof fetch = fetch
	): Promise<OAuthPollResponse> {
		const credentials = await OAuthTokenService.loadCredentials(sourceId);
		const pending = credentials.pendingAuth;

		if (pending?.flow !== 'device_code' || !pending.deviceCode) {
			return {
				pending: false,
				status: 'pending_auth',
				error: 'No device authorization is in progress. Start again with Re-authorize.',
			};
		}
		if (new Date(pending.expiresAt).getTime() < Date.now()) {
			const { pendingAuth: _dropped, ...rest } = credentials;
			await OAuthTokenService.persistTokens(sourceId, rest);
			return {
				pending: false,
				status: 'pending_auth',
				error: 'The device code expired before the sign-in was completed.',
			};
		}

		const body = new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			device_code: pending.deviceCode,
			client_id: credentials.clientId,
		});
		if (credentials.clientSecret) {
			body.set('client_secret', credentials.clientSecret);
		}

		const response = await fetchImpl(credentials.tokenEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
			signal: AbortSignal.timeout(30_000),
		});
		const payload: any = await response.json().catch(() => ({}));
		const outcome = interpretDeviceTokenResponse(response.status, payload);

		switch (outcome.kind) {
			case 'pending':
				return { pending: true, status: 'pending_auth' };
			case 'slow_down':
				return {
					pending: true,
					status: 'pending_auth',
					interval: (pending.interval ?? 5) + 5,
				};
			case 'success': {
				// The sign-in succeeded, so the source is authorized whatever the first
				// connection did. A refused connection travels back as a warning the dialog
				// can show without turning a working authorization into a failure.
				const completion = await this.completeAuthorization(sourceId, credentials, payload);
				return { pending: false, status: 'auth_success', warning: completion.warning };
			}
			case 'expired':
			case 'denied': {
				const { pendingAuth: _dropped, ...rest } = credentials;
				await OAuthTokenService.persistTokens(sourceId, rest);
				const message =
					outcome.kind === 'expired'
						? 'The device code expired before the sign-in was completed.'
						: 'The sign-in was declined.';
				await IngestionService.update(sourceId, { lastSyncStatusMessage: message });
				return { pending: false, status: 'pending_auth', error: message };
			}
			default:
				return { pending: false, status: 'pending_auth', error: outcome.message };
		}
	}

	/**
	 * Stores the granted tokens, proves they actually open the mailbox, and only then flips
	 * the source to auth_success THROUGH IngestionService.update — that transition is what
	 * triggers the initial import, and for a re-authorization of an existing source it
	 * re-runs the import, which the group-scoped dedup makes a no-op for already-archived
	 * mail.
	 *
	 * The connection test runs for the reporting, never as a barrier. A refused first
	 * connection is not evidence of a broken source: Outlook.com refuses IMAP sessions
	 * intermittently and the next cycle usually gets through. Blocking on it would be worse
	 * than useless, because IngestionService syncs only 'active' and 'error' sources — a
	 * source left in pending_auth is inert until a person re-authorizes it, so one unlucky
	 * handshake would park a mailbox that was about to work.
	 */
	static async completeAuthorization(
		sourceId: string,
		credentials: OAuthMailboxCredentials,
		tokenPayload: any
	): Promise<{ ok: boolean; message: string; warning?: string }> {
		const { pendingAuth: _dropped, ...rest } = credentials;
		const authorizedEmail = readAuthorizedEmail(tokenPayload.id_token) ?? undefined;
		const withTokens: OAuthMailboxCredentials = {
			...rest,
			authorizedEmail,
			tokens: {
				accessToken: tokenPayload.access_token,
				refreshToken:
					typeof tokenPayload.refresh_token === 'string'
						? tokenPayload.refresh_token
						: undefined,
				expiresAt: new Date(
					Date.now() + (Number(tokenPayload.expires_in) || 3600) * 1000 - EXPIRY_SKEW_MS
				).toISOString(),
			},
		};

		await OAuthTokenService.persistTokens(sourceId, withTokens);

		const intended = rest.email.trim().toLowerCase();
		const actual = authorizedEmail?.trim().toLowerCase();
		const mismatch = Boolean(actual && actual !== intended);
		if (mismatch) {
			logger.warn(
				{ sourceId, intended, actual },
				'OAuth mailbox authorized as a different account than the one configured'
			);
		}

		const failure = await this.verifyMailboxAccess(sourceId);
		if (failure) {
			logger.warn(
				{ sourceId, failure },
				'OAuth mailbox authorized, but the first connection was refused; syncing anyway'
			);
		}

		const message = failure
			? `Mailbox authorized. The first connection was refused - ${failure} Syncing will retry.`
			: mismatch
				? `Mailbox authorized as ${authorizedEmail}, which is not the address configured on this source (${rest.email}). Mail is archived for the account that signed in.`
				: 'Mailbox authorized.';
		await IngestionService.update(sourceId, {
			status: 'auth_success',
			lastSyncStatusMessage: message,
		});
		logger.info({ sourceId }, 'OAuth mailbox authorization completed');
		return { ok: true, message, warning: failure ?? undefined };
	}

	/**
	 * Opens and closes one session with the freshly stored tokens. Returns the failure text,
	 * or null when the mailbox opened. Reads the source back from the database rather than
	 * building a connector from the in-memory object, so the test exercises exactly the row
	 * and the token supplier that every later sync will use.
	 *
	 * Advisory only: the caller reports what this says and lets the source sync regardless.
	 */
	private static async verifyMailboxAccess(sourceId: string): Promise<string | null> {
		try {
			const source = await IngestionService.findById(sourceId);
			await EmailProviderFactory.createConnector(source).testConnection();
			return null;
		} catch (error) {
			return error instanceof Error && error.message
				? error.message
				: 'The mailbox refused the connection after authorization.';
		}
	}
}
