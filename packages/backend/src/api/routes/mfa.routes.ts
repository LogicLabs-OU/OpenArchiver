import { Router } from 'express';
import type { MfaController } from '../controllers/mfa.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { mfaChallengeLimiter, mfaManagementLimiter } from '../middleware/rateLimiter';
import { AuthService } from '../../services/AuthService';

/**
 * Self-service two-factor authentication, mounted at /v1/auth/mfa.
 *
 * `/verify` is deliberately public — it is the second half of the login flow, and the
 * caller holds only an mfaPending cookie, which `requireAuth` rejects outright.
 *
 * `requireAuth` is attached per route rather than with `router.use()`. A router-level
 * guard also runs for paths this router does not define, which would answer 401 instead
 * of falling through — and the enterprise module mounts /v1/auth/mfa/enroll-forced on
 * the app after this router is in place. Under a router-level guard those forced
 * enrollment requests, which by definition carry no full-access token, would never
 * reach their handler.
 */
export const createMfaRouter = (mfaController: MfaController, authService: AuthService): Router => {
	const router = Router();
	const auth = requireAuth(authService);

	/**
	 * @openapi
	 * /v1/auth/mfa/verify:
	 *   post:
	 *     summary: Complete the MFA login challenge
	 *     description: >
	 *       Verifies a TOTP or backup code against the short-lived `mfaPending` cookie issued by
	 *       the login endpoint, and returns a full-access token. Rate limited per IP, separately
	 *       from the authenticated management endpoints.
	 *     operationId: mfaVerify
	 *     tags:
	 *       - Auth
	 *     security: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - code
	 *             properties:
	 *               code:
	 *                 type: string
	 *                 description: A 6-digit TOTP code or a single-use backup code.
	 *                 example: "123456"
	 *     responses:
	 *       '200':
	 *         description: Verification successful.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/LoginResponse'
	 *       '400':
	 *         description: Pending token or code missing.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         description: Pending token invalid or expired, or the code did not verify.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '429':
	 *         description: Too many verification attempts.
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post('/verify', mfaChallengeLimiter, mfaController.verify);

	/**
	 * @openapi
	 * /v1/auth/mfa/status:
	 *   get:
	 *     summary: Get the caller's 2FA status
	 *     description: >
	 *       Returns whether TOTP is enabled for the authenticated user, when they enrolled, and
	 *       any enrollment deadline. `graceDeadline` is always null unless an enrollment policy
	 *       is in force.
	 *     operationId: getMfaStatus
	 *     tags:
	 *       - Auth
	 *     responses:
	 *       '200':
	 *         description: Status returned.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 totpEnabled:
	 *                   type: boolean
	 *                 enrolledAt:
	 *                   type: string
	 *                   nullable: true
	 *                   format: date-time
	 *                 graceDeadline:
	 *                   type: string
	 *                   nullable: true
	 *                   format: date-time
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get('/status', auth, mfaController.getStatus);

	/**
	 * @openapi
	 * /v1/auth/mfa/setup:
	 *   post:
	 *     summary: Begin 2FA enrollment
	 *     description: >
	 *       Generates a TOTP secret and returns the QR code and otpauth URI. The secret itself is
	 *       held server-side for 10 minutes and never sent to the client. Rate limited, because
	 *       each call replaces the pending secret.
	 *     operationId: setupMfa
	 *     tags:
	 *       - Auth
	 *     responses:
	 *       '200':
	 *         description: Setup data returned.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 otpAuthUrl:
	 *                   type: string
	 *                 qrCodeDataUrl:
	 *                   type: string
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '422':
	 *         description: Two-factor authentication has been disabled by policy.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '429':
	 *         description: Too many attempts.
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post('/setup', auth, mfaManagementLimiter, mfaController.setup);

	/**
	 * @openapi
	 * /v1/auth/mfa/enroll:
	 *   post:
	 *     summary: Confirm 2FA enrollment
	 *     description: >
	 *       Verifies a code against the pending secret, activates TOTP for the user, and returns
	 *       single-use backup codes. The backup codes are shown once and never retrievable again.
	 *     operationId: enrollMfa
	 *     tags:
	 *       - Auth
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - code
	 *             properties:
	 *               code:
	 *                 type: string
	 *                 example: "123456"
	 *     responses:
	 *       '201':
	 *         description: Enrollment complete.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 backupCodes:
	 *                   type: array
	 *                   items:
	 *                     type: string
	 *       '400':
	 *         description: Code missing.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '422':
	 *         description: Code invalid, setup expired, or the feature is disabled by policy.
	 *       '429':
	 *         description: Too many attempts.
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post('/enroll', auth, mfaManagementLimiter, mfaController.enroll);

	/**
	 * @openapi
	 * /v1/auth/mfa/disable:
	 *   post:
	 *     summary: Disable 2FA for the caller
	 *     description: Requires a currently valid TOTP or backup code. Clears the secret and all backup codes.
	 *     operationId: disableMfa
	 *     tags:
	 *       - Auth
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - code
	 *             properties:
	 *               code:
	 *                 type: string
	 *                 example: "123456"
	 *     responses:
	 *       '200':
	 *         description: Two-factor authentication disabled.
	 *       '400':
	 *         description: Code missing.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '422':
	 *         description: Invalid verification code.
	 *       '429':
	 *         description: Too many attempts.
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post('/disable', auth, mfaManagementLimiter, mfaController.disable);

	/**
	 * @openapi
	 * /v1/auth/mfa/backup-codes:
	 *   post:
	 *     summary: Regenerate backup codes
	 *     description: >
	 *       Replaces the caller's backup codes with a fresh set, invalidating the old ones.
	 *       Requires a currently valid TOTP or backup code.
	 *     operationId: regenerateMfaBackupCodes
	 *     tags:
	 *       - Auth
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - code
	 *             properties:
	 *               code:
	 *                 type: string
	 *                 example: "123456"
	 *     responses:
	 *       '200':
	 *         description: New backup codes returned.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 backupCodes:
	 *                   type: array
	 *                   items:
	 *                     type: string
	 *       '400':
	 *         description: Code missing.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '422':
	 *         description: Invalid verification code.
	 *       '429':
	 *         description: Too many attempts.
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post('/backup-codes', auth, mfaManagementLimiter, mfaController.regenerateBackupCodes);

	/**
	 * @openapi
	 * /v1/auth/mfa/users/{userId}:
	 *   delete:
	 *     summary: Reset a user's 2FA
	 *     description: >
	 *       Disables TOTP for another user without a verification code. Requires `manage:all`.
	 *       This is the recovery path for a user who has lost both their authenticator and their
	 *       backup codes; the action is audited with `adminAction: true`.
	 *     operationId: adminDisableUserMfa
	 *     tags:
	 *       - Auth
	 *     parameters:
	 *       - in: path
	 *         name: userId
	 *         required: true
	 *         schema:
	 *           type: string
	 *           format: uuid
	 *     responses:
	 *       '200':
	 *         description: Two-factor authentication disabled for the user.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '404':
	 *         description: User not found.
	 *       '422':
	 *         description: The user does not have two-factor authentication enabled.
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.delete(
		'/users/:userId',
		auth,
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		mfaController.adminDisableUserMfa
	);

	return router;
};
