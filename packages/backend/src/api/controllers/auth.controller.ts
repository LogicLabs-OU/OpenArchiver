import type { Request, Response } from 'express';
import { AuthService } from '../../services/AuthService';
import { UserService } from '../../services/UserService';
import { IamService } from '../../services/IamService';
import { db } from '../../database';
import * as schema from '../../database/schema';
import { eq, sql } from 'drizzle-orm';
import 'dotenv/config';
import { AuthorizationService } from '../../services/AuthorizationService';
import { CaslPolicy } from '@open-archiver/types';
import { logger } from '../../config/logger';

export class AuthController {
	#authService: AuthService;
	#userService: UserService;

	constructor(authService: AuthService, userService: UserService) {
		this.#authService = authService;
		this.#userService = userService;
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
			// Unreachable in practice — enforcement requires a prior SSO login,
			// which requires users, and setup requires none — but the union allows
			// it, and returning a denial body with a 201 would be nonsense.
			if (result && 'denied' in result) {
				return res.status(403).json({ message: req.t(result.reason) });
			}
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

			// The password was correct but the method is refused by policy —
			// an enterprise deployment requiring single sign-on. 403 rather than
			// 401: the credentials were not wrong, the door is.
			if ('denied' in result) {
				return res.status(403).json({ message: req.t(result.reason) });
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

	public status = async (req: Request, res: Response): Promise<Response> => {
		try {
			// The frontend root layout calls this on every page load, so read no more than is
			// needed to tell the three cases apart: no users (setup required), exactly one user
			// (legacy role repair below), or more than one.
			const users = await db.select({ id: schema.users.id }).from(schema.users).limit(2);

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
			// The first administrator is created exclusively through the /setup page. This endpoint
			// is a read-only probe and must never provision an account as a side effect.
			return res.status(200).json({ needsSetup: users.length === 0 });
		} catch (error) {
			logger.error({ err: error }, 'Status check error');
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};
}
