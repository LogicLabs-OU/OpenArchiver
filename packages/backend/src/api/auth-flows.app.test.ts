import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const acquireTokenByDeviceCode = vi.fn();
const jwtVerify = vi.fn();

vi.mock('@azure/msal-node', () => ({
	PublicClientApplication: class {
		acquireTokenByDeviceCode = acquireTokenByDeviceCode;
	},
}));

vi.mock('jose', () => ({
	createRemoteJWKSet: vi.fn(() => 'test-jwks'),
	jwtVerify,
}));

describe('application authentication flows', () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/openarchiver_test';
		process.env.STORAGE_TYPE = 'local';
		process.env.STORAGE_LOCAL_ROOT_PATH = '/tmp/openarchiver-app-tests';
		process.env.ENCRYPTION_KEY = 'app-test-encryption-key';
		process.env.OIDC_ISSUER_URL = 'https://identity.example.test';
		process.env.OIDC_CLIENT_ID = 'open-archiver';
		process.env.OIDC_CLIENT_SECRET = 'secret';
		process.env.OIDC_REDIRECT_URI = 'https://archive.example.test/v1/auth/oidc/callback';
		process.env.OIDC_COOKIE_SECURE = 'false';
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		vi.unstubAllGlobals();
	});

	it('returns an application error when Microsoft rejects before issuing a device code', async () => {
		acquireTokenByDeviceCode.mockRejectedValueOnce(new Error('invalid Microsoft client'));
		const { IngestionController } = await import('./controllers/ingestion.controller.js');
		const controller = new IngestionController();
		const app = express();
		app.use(express.json());
		app.post('/v1/ingestion-sources/microsoft-imap/device-auth', (req, res, next) => {
			req.user = { sub: 'user-1' } as typeof req.user;
			void controller.startMicrosoftImapDeviceAuth(req, res).catch(next);
		});

		const response = await request(app)
			.post('/v1/ingestion-sources/microsoft-imap/device-auth')
			.send({ clientId: 'invalid-client' })
			.timeout(1_000);

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ message: 'invalid Microsoft client' });
	});

	it('accepts supported Microsoft authorities and rejects authority injection', async () => {
		const { resolveMicrosoftImapAuthority } = await import(
			'../services/MicrosoftImapDeviceAuthService.js'
		);

		expect(
			resolveMicrosoftImapAuthority(
				'https://login.microsoftonline.com/consumers/oauth2/v2.0/'
			)
		).toBe('https://login.microsoftonline.com/consumers/oauth2/v2.0');
		expect(resolveMicrosoftImapAuthority('https://login.microsoftonline.com/common')).toBe(
			'https://login.microsoftonline.com/common'
		);
		expect(
			resolveMicrosoftImapAuthority(
				'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000'
			)
		).toBe('https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000');

		for (const authority of [
			'https://example.test/consumers/oauth2/v2.0',
			'https://login.microsoftonline.com.evil.test/consumers',
			'https://user:password@login.microsoftonline.com/consumers',
			'https://login.microsoftonline.com/consumers?redirect=https://example.test',
			'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
		]) {
			expect(() => resolveMicrosoftImapAuthority(authority)).toThrow();
		}
	});

	it('completes OIDC login through the application routes', async () => {
		const loginWithIdentity = vi.fn().mockResolvedValue({
			accessToken: 'application-session-token',
			user: { id: 'user-1', email: 'person@example.test' },
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						issuer: process.env.OIDC_ISSUER_URL,
						authorization_endpoint: 'https://identity.example.test/authorize',
					}),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						issuer: process.env.OIDC_ISSUER_URL,
						token_endpoint: 'https://identity.example.test/token',
						jwks_uri: 'https://identity.example.test/jwks',
						token_endpoint_auth_methods_supported: ['client_secret_basic'],
					}),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id_token: 'signed-id-token' }), { status: 200 })
			);
		vi.stubGlobal('fetch', fetchMock);

		const { AuthController } = await import('./controllers/auth.controller.js');
		const { createAuthRouter } = await import('./routes/auth.routes.js');
		const controller = new AuthController({ loginWithIdentity } as never, {} as never);
		const app = express();
		app.use(cookieParser());
		app.use('/v1/auth', createAuthRouter(controller));
		const agent = request.agent(app);

		const start = await agent.get('/v1/auth/oidc/start');
		expect(start.status).toBe(302);
		const authorizationUrl = new URL(start.headers.location);
		const state = authorizationUrl.searchParams.get('state');
		const setCookies = ([] as string[]).concat(start.headers['set-cookie'] ?? []);
		const nonceCookie = setCookies
			.map((cookie: string) => cookie.match(/^oidc_nonce=([^;]+)/)?.[1])
			.find(Boolean);
		expect(state).toBeTruthy();
		expect(nonceCookie).toBeTruthy();
		jwtVerify.mockResolvedValueOnce({
			payload: {
				nonce: decodeURIComponent(nonceCookie!),
				email: 'person@example.test',
				email_verified: true,
			},
		});

		const callback = await agent
			.get('/v1/auth/oidc/callback')
			.query({ code: 'authorization-code', state });

		expect(callback.status).toBe(302);
		expect(callback.headers.location).toBe('/dashboard');
		expect(callback.headers['set-cookie']).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^accessToken=application-session-token;/),
			])
		);
		expect(loginWithIdentity).toHaveBeenCalledWith(
			'person@example.test',
			expect.any(String),
			'oidc'
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
