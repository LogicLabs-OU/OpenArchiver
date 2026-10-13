import type { Request, Response } from 'express';
import { AuthService } from '../../services/AuthService';
import { mfaService } from '../../services/MfaService';
import { logger } from '../../config/logger';

/**
 * Self-service two-factor authentication.
 *
 * Everything here is available in both editions. The organisation-wide policy —
 * the master switch, mandatory enforcement, the grace window and the forced
 * enrollment flow that follows from it — lives in the enterprise
 * advanced-security module and reaches this code only through `MfaPolicyHook`.
 */
export class MfaController {
	#authService: AuthService;

	constructor(authService: AuthService) {
		this.#authService = authService;
	}

	public getStatus = async (req: Request, res: Response): Promise<Response> => {
		try {
			const userId = req.user?.sub;
			if (!userId) return res.status(401).json({ message: 'Unauthorized' });

			const status = await mfaService.getMfaStatus(userId);
			return res.json(status);
		} catch (error) {
			logger.error('getStatus error:', error);
			return res.status(500).json({ message: 'Internal server error' });
		}
	};

	public setup = async (req: Request, res: Response): Promise<Response> => {
		try {
			const userId = req.user?.sub;
			const userEmail = req.user?.email;
			if (!userId || !userEmail) return res.status(401).json({ message: 'Unauthorized' });

			const setupData = await mfaService.generateSetupData(userId, userEmail);
			return res.json(setupData);
		} catch (error) {
			if (error instanceof Error && error.message === 'mfa.featureDisabled') {
				return res
					.status(422)
					.json({ message: 'The Multi-Factor Authentication feature is disabled.' });
			}
			logger.error('setup error:', error);
			return res.status(500).json({ message: 'Internal server error' });
		}
	};

	public enroll = async (req: Request, res: Response): Promise<Response> => {
		try {
			const userId = req.user?.sub;
			if (!userId) return res.status(401).json({ message: 'Unauthorized' });

			const { code } = req.body;
			if (!code) {
				return res.status(400).json({ message: 'code is required' });
			}

			const result = await mfaService.enrollTotp(userId, code, req.ip ?? 'unknown');
			return res.status(201).json(result);
		} catch (error) {
			if (error instanceof Error && error.message === 'mfa.invalidCode') {
				return res.status(422).json({ message: 'Invalid verification code' });
			}
			if (error instanceof Error && error.message === 'mfa.setupExpired') {
				return res
					.status(422)
					.json({ message: 'Setup session expired. Please start setup again.' });
			}
			if (error instanceof Error && error.message === 'mfa.featureDisabled') {
				return res
					.status(422)
					.json({ message: 'The Multi-Factor Authentication feature is disabled.' });
			}
			logger.error('enroll error:', error);
			return res.status(500).json({ message: 'Internal server error' });
		}
	};

	public disable = async (req: Request, res: Response): Promise<Response> => {
		try {
			const userId = req.user?.sub;
			if (!userId) return res.status(401).json({ message: 'Unauthorized' });

			const { code } = req.body;
			if (!code) return res.status(400).json({ message: 'code is required' });

			await mfaService.disableTotp(userId, code, req.ip ?? 'unknown');
			return res.status(200).json({ message: 'Two-factor authentication disabled' });
		} catch (error) {
			if (error instanceof Error && error.message === 'mfa.invalidCode') {
				return res.status(422).json({ message: 'Invalid verification code' });
			}
			logger.error('disable error:', error);
			return res.status(500).json({ message: 'Internal server error' });
		}
	};

	public regenerateBackupCodes = async (req: Request, res: Response): Promise<Response> => {
		try {
			const userId = req.user?.sub;
			if (!userId) return res.status(401).json({ message: 'Unauthorized' });

			const { code } = req.body;
			if (!code) return res.status(400).json({ message: 'code is required' });

			const backupCodes = await mfaService.regenerateBackupCodes(
				userId,
				code,
				req.ip ?? 'unknown'
			);
			return res.json({ backupCodes });
		} catch (error) {
			if (error instanceof Error && error.message === 'mfa.invalidCode') {
				return res.status(422).json({ message: 'Invalid verification code' });
			}
			logger.error('regenerateBackupCodes error:', error);
			return res.status(500).json({ message: 'Internal server error' });
		}
	};

	/**
	 * Admin endpoint — disables TOTP for a specific user without requiring a verification code.
	 * Requires manage:all permission (Super Admin). Audits with adminAction=true.
	 *
	 * This is the only recovery path for a user who has lost both their authenticator
	 * and their backup codes, so it belongs in every edition.
	 */
	public adminDisableUserMfa = async (req: Request, res: Response): Promise<Response> => {
		try {
			const actorId = req.user?.sub;
			if (!actorId) return res.status(401).json({ message: 'Unauthorized' });

			const { userId } = req.params;
			if (!userId) return res.status(400).json({ message: 'userId is required' });

			await mfaService.adminDisableTotp(userId, actorId, req.ip ?? 'unknown');
			return res.status(200).json({ message: 'Two-factor authentication disabled for user' });
		} catch (error) {
			if (error instanceof Error && error.message === 'mfa.userNotFound') {
				return res.status(404).json({ message: 'User not found' });
			}
			if (error instanceof Error && error.message === 'mfa.notEnabled') {
				return res
					.status(422)
					.json({ message: 'Two-factor authentication is not enabled for this user' });
			}
			logger.error('adminDisableUserMfa error:', error);
			return res.status(500).json({ message: 'Internal server error' });
		}
	};

	/**
	 * Public endpoint (no requireAuth) — verifies the MFA pending token and TOTP code,
	 * then issues the full-access JWT.
	 *
	 * Only valid for tokens with mfaPending=true and mfaEnrollmentRequired absent/false.
	 * A forced-enrollment token is rejected here on purpose: that flow has its own
	 * endpoints in the enterprise module, and the mutual exclusion between the two is
	 * what stops an unenrolled user from talking their way past the challenge.
	 */
	public verify = async (req: Request, res: Response): Promise<Response> => {
		try {
			// Read the pending token from the httpOnly cookie set by the login endpoint
			const mfaPendingToken = req.cookies?.mfaPending;
			const { code } = req.body;

			if (!mfaPendingToken || !code) {
				return res.status(400).json({ message: 'MFA pending token and code are required' });
			}

			const payload = await this.#authService.verifyToken(mfaPendingToken);

			// Reject if: token invalid, not a pending token, missing subject,
			// or this is a forced-enrollment token (wrong endpoint for that flow).
			if (!payload || !payload.mfaPending || !payload.sub || payload.mfaEnrollmentRequired) {
				return res.status(401).json({ message: 'Invalid or expired MFA pending token' });
			}

			const isValid = await mfaService.verifyTotp(payload.sub, code, req.ip ?? 'unknown');
			if (!isValid) {
				return res.status(401).json({ message: 'Invalid MFA code' });
			}

			const loginResponse = await this.#authService.generateFullAccessToken(payload.sub);
			if (!loginResponse) {
				return res.status(401).json({ message: 'User not found' });
			}

			// Clear the pending token cookie — path must match the one used when setting it
			res.clearCookie('mfaPending', { path: '/' });

			return res.status(200).json(loginResponse);
		} catch (error) {
			logger.error('verify error:', error);
			return res.status(500).json({ message: 'Internal server error' });
		}
	};
}
