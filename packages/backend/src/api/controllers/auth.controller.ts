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

			return res.status(200).json(result);
		} catch (error) {
			console.error('Login error:', error);
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
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
				return res.status(200).json({ needsSetup: false });
			}
			return res.status(200).json({ needsSetup: needsSetupUser });
		} catch (error) {
			console.error('Status check error:', error);
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};
}
