import type { Request, Response } from 'express';
import { google } from 'googleapis';
import { createHmac, randomBytes } from 'crypto';
import { IngestionService } from '../../services/IngestionService';
import { UserService } from '../../services/UserService';
import { logger } from '../../config/logger';

const SCOPES = [
	'https://www.googleapis.com/auth/gmail.readonly',
	'https://www.googleapis.com/auth/userinfo.email',
];

function getOAuth2Client() {
	return new google.auth.OAuth2(
		process.env.GOOGLE_OAUTH_CLIENT_ID,
		process.env.GOOGLE_OAUTH_CLIENT_SECRET,
		process.env.GOOGLE_OAUTH_REDIRECT_URI
	);
}

function signState(payload: object): string {
	const data = Buffer.from(JSON.stringify(payload)).toString('base64');
	const sig = createHmac('sha256', process.env.JWT_SECRET!)
		.update(data)
		.digest('hex');
	return `${data}.${sig}`;
}

function verifyState(state: string): { userId: string; name: string } | null {
	try {
		const [data, sig] = state.split('.');
		const expected = createHmac('sha256', process.env.JWT_SECRET!)
			.update(data)
			.digest('hex');
		if (sig !== expected) return null;
		return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

export class OAuthController {
	/**
	 * GET /v1/oauth/google/authorize?name=<source-name>
	 * Protected — user must be logged in.
	 * Redirects to Google OAuth consent screen.
	 */
	public googleAuthorize = async (req: Request, res: Response): Promise<void> => {
		const { name } = req.query;
		const userId = req.user?.sub;

		if (!userId) {
			res.status(401).json({ message: 'Unauthorized' });
			return;
		}

		if (!name || typeof name !== 'string') {
			res.status(400).json({ message: 'Missing required query parameter: name' });
			return;
		}

		if (
			!process.env.GOOGLE_OAUTH_CLIENT_ID ||
			!process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
			!process.env.GOOGLE_OAUTH_REDIRECT_URI
		) {
			res.status(500).json({ message: 'Google OAuth is not configured on this server.' });
			return;
		}

		const state = signState({ userId, name, nonce: randomBytes(8).toString('hex') });
		const oauth2Client = getOAuth2Client();
		const url = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			prompt: 'consent',
			scope: SCOPES,
			state,
		});

		res.status(200).json({ url });
	};

	/**
	 * GET /v1/oauth/google/callback?code=...&state=...
	 * Public — Google redirects here after consent.
	 * Creates an ingestion source and redirects to dashboard.
	 */
	public googleCallback = async (req: Request, res: Response): Promise<void> => {
		const frontendUrl = process.env.APP_URL || 'http://localhost:3000';
		const { code, state, error } = req.query;

		if (error) {
			logger.warn({ error }, 'Google OAuth consent was denied or cancelled.');
			res.redirect(`${frontendUrl}/dashboard/ingestions?error=oauth_cancelled`);
			return;
		}

		if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
			res.redirect(`${frontendUrl}/dashboard/ingestions?error=oauth_invalid_response`);
			return;
		}

		const payload = verifyState(state);
		if (!payload) {
			logger.warn('Google OAuth callback received invalid state parameter.');
			res.redirect(`${frontendUrl}/dashboard/ingestions?error=oauth_invalid_state`);
			return;
		}

		const { userId, name } = payload;

		try {
			const oauth2Client = getOAuth2Client();
			const { tokens } = await oauth2Client.getToken(code);

			if (!tokens.access_token || !tokens.refresh_token) {
				throw new Error('Google did not return required tokens.');
			}

			oauth2Client.setCredentials(tokens);

			// Get the user's email address from Google
			const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
			const { data: userInfo } = await oauth2.userinfo.get();

			if (!userInfo.email) {
				throw new Error('Could not retrieve email from Google account.');
			}

			// Fetch the OpenArchiver user to pass as actor
			const userService = new UserService();
			const actor = await userService.findById(userId);
			if (!actor) {
				throw new Error('Could not find user account.');
			}

			await IngestionService.create(
				{
					name,
					provider: 'google_oauth',
					providerConfig: {
						type: 'google_oauth',
						email: userInfo.email,
						accessToken: tokens.access_token,
						refreshToken: tokens.refresh_token,
					},
				},
				userId,
				actor,
				req.ip || 'unknown'
			);

			res.redirect(`${frontendUrl}/dashboard/ingestions?connected=google`);
		} catch (err) {
			logger.error({ err }, 'Google OAuth callback failed.');
			res.redirect(`${frontendUrl}/dashboard/ingestions?error=oauth_failed`);
		}
	};
}
