import { eq } from 'drizzle-orm';
import type { OAuthMailboxCredentials } from '@open-archiver/types';
import { db } from '../../database';
import { ingestionSources } from '../../database/schema';
import { CryptoService } from '../CryptoService';
import { logger } from '../../config/logger';

/** How close to expiry a stored access token is still trusted. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** Clock-skew allowance subtracted from the provider's expires_in when storing. */
const EXPIRY_SKEW_MS = 60 * 1000;

/**
 * Thrown when the refresh token itself is dead — revoked consent, or a consumer refresh
 * token past its ~90-day idle expiry. Retrying cannot help; only a person can, so the
 * message says exactly what to click. It travels the existing failure path untouched:
 * process-mailbox records it, sync-cycle-finished writes it into lastSyncStatusMessage,
 * and the status hover card shows it.
 */
export class OAuthReauthorizationRequiredError extends Error {
	constructor(email: string) {
		super(
			`OAuth authorization has expired or been revoked for ${email}. ` +
				`Open the ingestion source menu and click "Re-authorize".`
		);
		this.name = 'OAuthReauthorizationRequiredError';
	}
}

interface StoredTokens {
	accessToken: string;
	refreshToken?: string;
	expiresAt: string;
}

/**
 * Owns the tokens of oauth_mailbox sources: hands out a currently-valid access token and
 * refreshes + persists behind the scenes.
 *
 * DELIBERATELY imports neither IngestionService nor EmailProviderFactory — the factory
 * calls in here to build the connector's token supplier, and IngestionService imports the
 * factory, so anything more would close an import cycle.
 */
export class OAuthTokenService {
	/**
	 * The connector's token supplier. Reads the row FRESH on every call rather than
	 * trusting a credentials object captured at connector construction: an IMAP reconnect
	 * minutes into a sync must see tokens another code path refreshed in the meantime,
	 * and with Microsoft rotating consumer refresh tokens, using a stale refresh token is
	 * how a source locks itself out.
	 */
	public static async getValidAccessToken(
		sourceId: string,
		fetchImpl: typeof fetch = fetch
	): Promise<string> {
		const credentials = await this.loadCredentials(sourceId);
		const tokens = credentials.tokens;
		if (!tokens?.accessToken) {
			throw new OAuthReauthorizationRequiredError(credentials.email);
		}

		if (new Date(tokens.expiresAt).getTime() - Date.now() > EXPIRY_MARGIN_MS) {
			return tokens.accessToken;
		}

		if (!tokens.refreshToken) {
			throw new OAuthReauthorizationRequiredError(credentials.email);
		}

		const refreshed = await this.refreshTokens(sourceId, credentials, fetchImpl);
		return refreshed.accessToken;
	}

	/**
	 * One refresh-token grant, persisted BEFORE the token is returned. Persist-first
	 * matters because providers that rotate refresh tokens (Microsoft consumer accounts
	 * do) invalidate the old one shortly after the new one is used — returning before the
	 * write could strand the only valid refresh token in a crashed process.
	 *
	 * Concurrency is last-write-wins by design: workers are single-writer per source
	 * (claimForSync/claimForImport), so the only overlap is an API-side connection test
	 * against a running sync, and the rotation grace window covers that.
	 */
	static async refreshTokens(
		sourceId: string,
		credentials: OAuthMailboxCredentials,
		fetchImpl: typeof fetch = fetch
	): Promise<StoredTokens> {
		const body = new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: credentials.tokens!.refreshToken!,
			client_id: credentials.clientId,
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
			// Network trouble is not a dead grant: rethrow untouched so the job retries.
			throw new Error(
				`OAuth token refresh could not reach the token endpoint: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}

		if (status !== 200 || typeof payload?.access_token !== 'string') {
			// invalid_grant: revoked/expired refresh token. invalid_client: the client
			// registration itself changed. Both need a person, not a retry.
			if (payload?.error === 'invalid_grant' || payload?.error === 'invalid_client') {
				logger.warn(
					{ sourceId, error: payload.error },
					'OAuth refresh rejected; re-authorization required'
				);
				throw new OAuthReauthorizationRequiredError(credentials.email);
			}
			throw new Error(
				`OAuth token refresh failed (${status}): ${payload?.error_description || payload?.error || 'unknown error'}`
			);
		}

		const tokens: StoredTokens = {
			accessToken: payload.access_token,
			// A provider that does not rotate omits refresh_token; keep the old one then.
			refreshToken:
				typeof payload.refresh_token === 'string'
					? payload.refresh_token
					: credentials.tokens!.refreshToken,
			expiresAt: new Date(
				Date.now() + (Number(payload.expires_in) || 3600) * 1000 - EXPIRY_SKEW_MS
			).toISOString(),
		};

		await this.persistTokens(sourceId, { ...credentials, tokens });
		logger.info({ sourceId }, 'OAuth access token refreshed');
		return tokens;
	}

	/** Writes the full credentials object back, encrypted, without touching other columns. */
	public static async persistTokens(
		sourceId: string,
		credentials: OAuthMailboxCredentials
	): Promise<void> {
		await db
			.update(ingestionSources)
			.set({ credentials: CryptoService.encryptObject(credentials), updatedAt: new Date() })
			.where(eq(ingestionSources.id, sourceId));
	}

	static async loadCredentials(sourceId: string): Promise<OAuthMailboxCredentials> {
		const [row] = await db
			.select()
			.from(ingestionSources)
			.where(eq(ingestionSources.id, sourceId))
			.limit(1);
		if (!row) {
			throw new Error('Ingestion source not found');
		}
		if (row.provider !== 'oauth_mailbox') {
			throw new Error('Ingestion source is not an OAuth mailbox source');
		}
		const credentials = CryptoService.decryptObject<OAuthMailboxCredentials>(
			row.credentials as string
		);
		if (!credentials) {
			throw new Error('Failed to decrypt ingestion source credentials.');
		}
		return credentials;
	}
}
