import { Router } from 'express';
import type { AuthController } from '../controllers/auth.controller';

export const createAuthRouter = (authController: AuthController): Router => {
	const router = Router();

	/**
	 * @route POST /api/v1/auth/setup
	 * @description Creates the initial administrator user.
	 * @access Public
	 */
	router.post('/setup', authController.setup);

	/**
	 * @route POST /api/v1/auth/login
	 * @description Authenticates a user and returns a JWT.
	 * @access Public
	 */
	router.post('/login', authController.login);

	/**
	 * @route GET /api/v1/auth/status
	 * @description Checks if the application has been set up.
	 * @access Public
	 */
	router.get('/status', authController.status);

	return router;
};
