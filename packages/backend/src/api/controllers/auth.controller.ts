import type { Request, Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AuthService } from '../../services/AuthService';
import { UserService } from '../../services/UserService';
import { IamService } from '../../services/IamService';
import { db } from '../../database';
import * as schema from '../../database/schema';
import { eq, sql } from 'drizzle-orm';
import 'dotenv/config';
import { AuthorizationService } from '../../services/AuthorizationService';
import { CaslPolicy } from '@open-archiver/types';

export class AuthController {
	#authService: AuthService;
	#userService: UserService;

	constructor(authService: AuthService, userService: UserService) {
		this.#authService = authService;
		this.#userService = userService;
	}

	private sessionCookieName(req: Request): string {
		const forwardedPort = req.get('x-forwarded-port') || '';
		return forwardedPort ? `accessToken_${forwardedPort}` : 'accessToken';
	}

	private oidcCookieSecure(): boolean {
		if (process.env.OIDC_COOKIE_SECURE !== undefined) {
			return process.env.OIDC_COOKIE_SECURE === 'true';
		}
		return process.env.NODE_ENV === 'production';
	}

	private oidcConfigured(): boolean {
		return Boolean(
			process.env.OIDC_ISSUER_URL &&
				process.env.OIDC_CLIENT_ID &&
				process.env.OIDC_REDIRECT_URI
		);
	}

	private oidcDiscoveryUrl(issuer: string): string {
		return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
	}
	/**
	 * Only used for setting up the instance, should only be displayed once upon instance set up.
	 * @param req
	 * @param res
	 * @returns
	 */
	public setup = async (req: Request, res: Response): Promise<Response> => {
		const { email, password, first_name, last_name } = req.body;

		if (!email || !password || !first_name || !last_name) {
			return res.status(400).json({ message: req.t('auth.setup.allFieldsRequired') });
		}

		try {
			const userCountResult = await db
				.select({ count: sql<number>`count(*)` })
				.from(schema.users);
			const userCount = Number(userCountResult[0].count);

			if (userCount > 0) {
				return res.status(403).json({ message: req.t('auth.setup.alreadyCompleted') });
			}

			const newUser = await this.#userService.createAdminUser(
				{ email, password, first_name, last_name },
				true
			);
			const result = await this.#authService.login(email, password, req.ip || 'unknown');
			return res.status(201).json(result);
		} catch (error) {
			console.error('Setup error:', error);
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};

	public login = async (req: Request, res: Response): Promise<Response> => {
		const { email, password } = req.body;

		if (!email || !password) {
			return res.status(400).json({ message: req.t('auth.login.emailAndPasswordRequired') });
		}

		try {
			const result = await this.#authService.login(email, password, req.ip || 'unknown');

			if (!result) {
				return res.status(401).json({ message: req.t('auth.login.invalidCredentials') });
			}

			// MFA pending — set the pending token as an httpOnly cookie and signal the client to redirect.
			// If the user is grace-expired and unenrolled, also signal enrollmentRequired so the
			// frontend can redirect to the forced-enrollment page instead of the normal MFA challenge.
			if ('requiresMfa' in result) {
				// Determine whether the pending token carries the enrollment flag by verifying it
				const decodedPayload = await this.#authService.verifyToken(result.mfaPendingToken);
				const enrollmentRequired = decodedPayload?.mfaEnrollmentRequired === true;

				// Extend the cookie maxAge for enrollment flow (10 min) vs normal MFA (5 min)
				const cookieMaxAge = enrollmentRequired ? 10 * 60 * 1000 : 5 * 60 * 1000;

				res.cookie('mfaPending', result.mfaPendingToken, {
					httpOnly: true,
					sameSite: 'strict',
					// Secure in all environments except explicit local development.
					// Prevents the pending token from being transmitted over plain HTTP
					// in staging, QA, or production environments.
					secure: process.env.NODE_ENV !== 'development',
					maxAge: cookieMaxAge,
					// Use '/' so the cookie is sent regardless of the /api proxy prefix
					path: '/',
				});
				return res.status(200).json({ requiresMfa: true, enrollmentRequired });
			}

			return res.status(200).json(result);
		} catch (error) {
			console.error('Login error:', error);
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};
	public oidcStart = async (req: Request, res: Response): Promise<Response> => {
		try {
			const issuer = process.env.OIDC_ISSUER_URL || '';
			const clientId = process.env.OIDC_CLIENT_ID || '';
			const redirectUri = process.env.OIDC_REDIRECT_URI || '';
			if (!this.oidcConfigured()) {
				return res.status(503).json({ message: 'OIDC is not configured' });
			}
			const discovery = await fetch(this.oidcDiscoveryUrl(issuer)).then((r) => {
				if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
				return r.json() as Promise<{ issuer: string; authorization_endpoint: string }>;
			});
			if (discovery.issuer !== issuer) {
				throw new Error('OIDC discovery issuer does not match OIDC_ISSUER_URL');
			}
			const state = randomBytes(32).toString('base64url');
			const verifier = randomBytes(48).toString('base64url');
			const nonce = randomBytes(32).toString('base64url');
			const challenge = createHash('sha256').update(verifier).digest('base64url');
			const secure = this.oidcCookieSecure();
			const cookie = {
				httpOnly: true,
				sameSite: 'lax' as const,
				secure,
				maxAge: 600_000,
				path: '/',
			};
			res.cookie('oidc_state', state, cookie);
			res.cookie('oidc_verifier', verifier, cookie);
			res.cookie('oidc_nonce', nonce, cookie);
			const url = new URL(discovery.authorization_endpoint);
			url.searchParams.set('client_id', clientId);
			url.searchParams.set('redirect_uri', redirectUri);
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', process.env.OIDC_SCOPES || 'openid profile email');
			url.searchParams.set('state', state);
			url.searchParams.set('nonce', nonce);
			url.searchParams.set('code_challenge', challenge);
			url.searchParams.set('code_challenge_method', 'S256');
			res.redirect(url.toString());
			return res;
		} catch (error) {
			console.error('OIDC start error:', error);
			return res.status(502).json({ message: 'OIDC provider is unavailable' });
		}
	};

	public oidcCallback = async (req: Request, res: Response): Promise<Response> => {
		try {
			const code = typeof req.query.code === 'string' ? req.query.code : '';
			const state = typeof req.query.state === 'string' ? req.query.state : '';
			const expectedState = req.cookies?.oidc_state || '';
			const verifier = req.cookies?.oidc_verifier || '';
			const nonce = req.cookies?.oidc_nonce || '';
			const stateBytes = Buffer.from(state);
			const expectedBytes = Buffer.from(expectedState);
			if (
				!code ||
				!verifier ||
				!state ||
				stateBytes.length !== expectedBytes.length ||
				!timingSafeEqual(stateBytes, expectedBytes)
			) {
				return res.status(400).json({ message: 'Invalid OIDC callback state' });
			}
			const issuer = process.env.OIDC_ISSUER_URL || '';
			const clientId = process.env.OIDC_CLIENT_ID || '';
			const clientSecret = process.env.OIDC_CLIENT_SECRET || '';
			const redirectUri = process.env.OIDC_REDIRECT_URI || '';
			const discovery = await fetch(this.oidcDiscoveryUrl(issuer)).then((r) => {
				if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
				return r.json() as Promise<{
					issuer: string;
					token_endpoint: string;
					jwks_uri: string;
					token_endpoint_auth_methods_supported?: string[];
				}>;
			});
			if (discovery.issuer !== issuer) {
				throw new Error('OIDC discovery issuer does not match OIDC_ISSUER_URL');
			}
			const supportedAuthMethods = discovery.token_endpoint_auth_methods_supported || [
				'client_secret_basic',
			];
			const tokenRequestHeaders: Record<string, string> = {
				'content-type': 'application/x-www-form-urlencoded',
			};
			const tokenRequestBody = new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: redirectUri,
				code_verifier: verifier,
			});
			if (clientSecret && supportedAuthMethods.includes('client_secret_basic')) {
				const credentials = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
				tokenRequestHeaders.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
			} else if (clientSecret && supportedAuthMethods.includes('client_secret_post')) {
				tokenRequestBody.set('client_id', clientId);
				tokenRequestBody.set('client_secret', clientSecret);
			} else if (!clientSecret && supportedAuthMethods.includes('none')) {
				tokenRequestBody.set('client_id', clientId);
			} else {
				throw new Error(
					'OIDC provider does not support a configured token authentication method'
				);
			}
			const tokenResponse = await fetch(discovery.token_endpoint, {
				method: 'POST',
				headers: tokenRequestHeaders,
				body: tokenRequestBody,
			});
			if (!tokenResponse.ok)
				throw new Error(`OIDC token exchange failed: ${tokenResponse.status}`);
			const tokens = (await tokenResponse.json()) as { id_token?: string };
			if (!tokens.id_token) throw new Error('OIDC provider returned no ID token');
			const { payload } = await jwtVerify(
				tokens.id_token,
				createRemoteJWKSet(new URL(discovery.jwks_uri)),
				{ issuer: discovery.issuer, audience: clientId }
			);
			if (!nonce || payload.nonce !== nonce) {
				return res.status(400).json({ message: 'Invalid OIDC token nonce' });
			}
			const claim = process.env.OIDC_EMAIL_CLAIM || 'email';
			const verifiedClaim = process.env.OIDC_EMAIL_VERIFIED_CLAIM || 'email_verified';
			const email = String(payload[claim] || payload.email || '').trim();
			if (!email || !email.includes('@')) {
				return res.status(403).json({ message: 'OIDC identity has no usable email claim' });
			}
			if (payload[verifiedClaim] !== true) {
				return res.status(403).json({ message: 'OIDC identity email is not verified' });
			}
			const login = await this.#authService.loginWithIdentity(
				email,
				req.ip || 'unknown',
				'oidc'
			);
			if (!login) return res.status(403).json({ message: 'OIDC user cannot log in' });
			res.clearCookie('oidc_state', { path: '/' });
			res.clearCookie('oidc_verifier', { path: '/' });
			res.clearCookie('oidc_nonce', { path: '/' });
			res.cookie(this.sessionCookieName(req), login.accessToken, {
				httpOnly: true,
				sameSite: 'lax',
				secure: this.oidcCookieSecure(),
				maxAge: 604_800_000,
				path: '/',
			});
			res.redirect('/dashboard');
			return res;
		} catch (error) {
			console.error('OIDC callback error:', error);
			return res.status(502).json({ message: 'OIDC login failed' });
		}
	};
	public logout = async (req: Request, res: Response): Promise<Response> => {
		const cookieName = this.sessionCookieName(req);
		await this.#authService.logout(req.cookies?.[cookieName], req.ip || 'unknown');
		res.clearCookie(cookieName, { path: '/' });
		return res.status(204).send();
	};

	public status = async (req: Request, res: Response): Promise<Response> => {
		try {
			const users = await db.select().from(schema.users);

			/**
			 * Check the situation where the only user has "Super Admin" role, but they don't actually have Super Admin permission because the role was set up in an earlier version, we need to change that "Super Admin" role to the one used in the current version.
			 */
			if (users.length === 1) {
				const iamService = new IamService();
				const userRoles = await iamService.getRolesForUser(users[0].id);
				if (userRoles.some((r) => r.name === 'Super Admin')) {
					const authorizationService = new AuthorizationService();
					const hasAdminPermission = await authorizationService.can(
						users[0].id,
						'manage',
						'all'
					);
					if (!hasAdminPermission) {
						const suerAdminPolicies: CaslPolicy[] = [
							{
								action: 'manage',
								subject: 'all',
							},
						];
						await db
							.update(schema.roles)
							.set({
								policies: suerAdminPolicies,
								slug: 'predefined_super_admin',
							})
							.where(eq(schema.roles.name, 'Super Admin'));
					}
				}
			}
			// in case user uses older version with admin user variables, we will create the admin user using those variables.
			const needsSetupUser = users.length === 0;
			if (needsSetupUser && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
				await this.#userService.createAdminUser(
					{
						email: process.env.ADMIN_EMAIL,
						password: process.env.ADMIN_PASSWORD,
						first_name: 'Admin',
						last_name: 'User',
					},
					true
				);
				return res
					.status(200)
					.json({ needsSetup: false, oidcEnabled: this.oidcConfigured() });
			}
			return res
				.status(200)
				.json({ needsSetup: needsSetupUser, oidcEnabled: this.oidcConfigured() });
		} catch (error) {
			console.error('Status check error:', error);
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};
}
