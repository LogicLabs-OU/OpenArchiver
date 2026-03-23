import { Router } from 'express';
import { OAuthController } from '../controllers/oauth.controller';
import { requireAuth } from '../middleware/requireAuth';
import type { AuthService } from '../../services/AuthService';

export const createOAuthRouter = (authService: AuthService): Router => {
	const router = Router();
	const controller = new OAuthController();

	/**
	 * @route GET /v1/oauth/google/authorize?name=<source-name>
	 * @description Initiates the Google OAuth flow for Gmail individual account connection.
	 * @access Protected (JWT required)
	 */
	router.get('/google/authorize', requireAuth(authService), controller.googleAuthorize);

	/**
	 * @route GET /v1/oauth/google/callback
	 * @description Handles the Google OAuth callback, exchanges code for tokens,
	 *              creates an ingestion source, and redirects to the dashboard.
	 * @access Public (called by Google)
	 */
	router.get('/google/callback', controller.googleCallback);

	return router;
};
