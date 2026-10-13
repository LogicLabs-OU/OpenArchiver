import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { hash, compare } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { db } from '../database';
import { users } from '../database/schema/users';
import { AuditService } from './AuditService';
import { CryptoService } from './CryptoService';
import { MfaPolicyHook } from '../hooks/MfaPolicyHook';
import { eq } from 'drizzle-orm';
import type {
	MfaCheckResult,
	MfaEnrollResponse,
	MfaSetupResponse,
	MfaStatus,
} from '@open-archiver/types';
import { mfaRedisStore } from './MfaRedisStore';

const APP_NAME = 'Open Archiver';
const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_BCRYPT_ROUNDS = 10;

const auditService = new AuditService();

export class MfaService {
	/**
	 * Returns the current TOTP enrollment status for the given user.
	 *
	 * `graceDeadline` comes from the policy hook, so it is always null in the
	 * open-source edition and carries the enforcement deadline only when the
	 * enterprise advanced-security module has registered a provider.
	 */
	public async getMfaStatus(userId: string): Promise<MfaStatus> {
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { totpEnabled: true, totpEnrolledAt: true },
		});

		// An enrolled user has no deadline to meet, so the hook is only consulted
		// for users who have not set 2FA up yet.
		const graceDeadline =
			user && !user.totpEnabled ? await MfaPolicyHook.getGraceDeadline(userId) : null;

		return {
			totpEnabled: user?.totpEnabled ?? false,
			enrolledAt: user?.totpEnrolledAt?.toISOString() ?? null,
			graceDeadline,
		};
	}

	/**
	 * Generates a new TOTP secret, QR code, and stores the secret server-side in Redis.
	 * The client must call enrollTotp() with a valid TOTP code to confirm enrollment.
	 * The secret is bound to the user in Redis (10 min TTL) and never returned to the client.
	 * Throws if a registered policy provider has disabled the 2FA feature entirely.
	 */
	public async generateSetupData(userId: string, userEmail: string): Promise<MfaSetupResponse> {
		if (!(await MfaPolicyHook.isEnrollmentAllowed())) {
			throw new Error('mfa.featureDisabled');
		}

		const secret = generateSecret();
		const otpAuthUrl = generateURI({
			secret,
			label: userEmail,
			issuer: APP_NAME,
			strategy: 'totp',
		});
		const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

		// Store the secret server-side so the enroll step fetches it from Redis, not from the client.
		await mfaRedisStore.storePendingSecret(userId, secret);

		return { otpAuthUrl, qrCodeDataUrl };
	}

	/**
	 * Finalizes TOTP enrollment: retrieves the pending secret from Redis, verifies the provided code,
	 * encrypts and persists the secret, generates hashed backup codes, and emits an audit log.
	 * Returns the plaintext backup codes (shown once to the user).
	 *
	 * Throws if:
	 * - A registered policy provider has disabled the 2FA feature
	 * - The setup secret has expired or was never generated (mfa.setupExpired)
	 * - The verification code does not match the secret
	 */
	public async enrollTotp(
		userId: string,
		code: string,
		actorIp: string
	): Promise<MfaEnrollResponse> {
		// Guard: enrollment is blocked when a policy provider has disabled the feature
		if (!(await MfaPolicyHook.isEnrollmentAllowed())) {
			throw new Error('mfa.featureDisabled');
		}

		// Fetch the server-side pending secret — never trust the client to supply this.
		const secret = await mfaRedisStore.getPendingSecret(userId);
		if (!secret) {
			throw new Error('mfa.setupExpired');
		}

		// verifySync returns a VerifyResult object with a `.valid` boolean property
		const result = verifySync({ token: code, secret, strategy: 'totp' });
		if (!result.valid) {
			throw new Error('mfa.invalidCode');
		}

		const encryptedSecret = CryptoService.encrypt(secret);
		const { plainCodes, hashedCodes } = await this.generateBackupCodesInternal();

		await db
			.update(users)
			.set({
				totpSecret: encryptedSecret,
				totpEnabled: true,
				totpEnrolledAt: new Date(),
				totpBackupCodes: hashedCodes,
			})
			.where(eq(users.id, userId));

		// Clean up the pending secret from Redis after successful enrollment
		await mfaRedisStore.deletePendingSecret(userId);

		await auditService.createAuditLog({
			actorIdentifier: userId,
			actionType: 'TOTP_ENROLLED',
			targetType: 'User',
			targetId: userId,
			actorIp,
			details: {},
		});

		return { backupCodes: plainCodes };
	}

	/**
	 * Pure cryptographic check: validates a 6-digit TOTP code or a single-use backup code.
	 * Backup codes are consumed (removed from DB) on first use.
	 *
	 * This method intentionally has NO replay-protection side effects and emits NO audit log.
	 * It is used internally by both the login verification path (which adds replay protection
	 * on top) and the management paths (disable, regen backup codes) where the caller is
	 * already authenticated and replay protection must not block a valid code that was just
	 * used to complete the login challenge.
	 *
	 * Returns true if valid, false otherwise.
	 */
	private async checkCode(userId: string, code: string): Promise<boolean> {
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: {
				totpEnabled: true,
				totpSecret: true,
				totpBackupCodes: true,
			},
		});

		if (!user || !user.totpEnabled || !user.totpSecret) {
			return false;
		}

		const decryptedSecret = CryptoService.decrypt(user.totpSecret);
		if (!decryptedSecret) {
			return false;
		}

		// Try regular TOTP first (6-digit code)
		if (/^\d{6}$/.test(code)) {
			const result = verifySync({
				token: code,
				secret: decryptedSecret,
				strategy: 'totp',
			});
			if (result.valid) {
				return true;
			}
		}

		// Try backup codes (case-insensitive, bcrypt-hashed). Consume on first match.
		const backupCodes = user.totpBackupCodes ?? [];
		for (let i = 0; i < backupCodes.length; i++) {
			const match = await compare(code.toUpperCase(), backupCodes[i]);
			if (match) {
				const remainingCodes = backupCodes.filter((_, idx) => idx !== i);
				await db
					.update(users)
					.set({ totpBackupCodes: remainingCodes })
					.where(eq(users.id, userId));
				return true;
			}
		}

		return false;
	}

	/**
	 * Verifies a 6-digit TOTP code or a single-use backup code for the given user.
	 * Used exclusively by the MFA login challenge endpoint.
	 *
	 * Adds replay protection on top of checkCode() — a token already used to complete
	 * a login within the same TOTP window (90 s) is rejected to prevent session hijacking.
	 * Emits MFA_VERIFY_SUCCESS / BACKUP_CODE_USED / MFA_VERIFY_FAIL audit log entries.
	 *
	 * NOTE: Do NOT call this from management operations (disable, regen backup codes).
	 * Those operations are already behind requireAuth and must not be blocked by the
	 * replay-protection window. Use checkCode() via the respective management methods.
	 */
	public async verifyTotp(userId: string, code: string, actorIp: string): Promise<boolean> {
		// Determine whether this is a TOTP code so we know which audit action to log
		const isTotpCode = /^\d{6}$/.test(code);

		// Replay protection: reject a TOTP token that was already consumed in this window.
		// Backup codes are one-time-use by construction (consumed in DB by checkCode), so
		// replay protection is not needed for them.
		if (isTotpCode) {
			const alreadyUsed = await mfaRedisStore.isTokenUsed(userId, code);
			if (alreadyUsed) {
				await auditService.createAuditLog({
					actorIdentifier: userId,
					actionType: 'MFA_VERIFY_FAIL',
					targetType: 'User',
					targetId: userId,
					actorIp,
					details: { reason: 'replay' },
				});
				return false;
			}
		}

		const valid = await this.checkCode(userId, code);

		if (valid) {
			if (isTotpCode) {
				// Mark the token as used to prevent replay within the same window
				await mfaRedisStore.storeUsedToken(userId, code);
				await auditService.createAuditLog({
					actorIdentifier: userId,
					actionType: 'MFA_VERIFY_SUCCESS',
					targetType: 'User',
					targetId: userId,
					actorIp,
					details: { method: 'totp' },
				});
			} else {
				// Backup code — consumption already handled in checkCode(); just audit it
				await auditService.createAuditLog({
					actorIdentifier: userId,
					actionType: 'BACKUP_CODE_USED',
					targetType: 'User',
					targetId: userId,
					actorIp,
					details: {},
				});
			}
			return true;
		}

		await auditService.createAuditLog({
			actorIdentifier: userId,
			actionType: 'MFA_VERIFY_FAIL',
			targetType: 'User',
			targetId: userId,
			actorIp,
			details: {},
		});

		return false;
	}

	/**
	 * Disables TOTP for the given user after verifying their current TOTP code.
	 * Clears all TOTP-related fields from the database.
	 * Throws if the code is invalid.
	 *
	 * Uses checkCode() directly (not verifyTotp) to bypass replay protection.
	 * This is required because the user may have used the same code moments ago
	 * to complete the MFA login challenge, and replay protection would otherwise
	 * incorrectly reject a valid code within the same 90-second window.
	 */
	public async disableTotp(userId: string, code: string, actorIp: string): Promise<void> {
		const valid = await this.checkCode(userId, code);
		if (!valid) {
			throw new Error('mfa.invalidCode');
		}

		await db
			.update(users)
			.set({
				totpSecret: null,
				totpEnabled: false,
				totpEnrolledAt: null,
				totpBackupCodes: null,
			})
			.where(eq(users.id, userId));

		await auditService.createAuditLog({
			actorIdentifier: userId,
			actionType: 'TOTP_DISABLED',
			targetType: 'User',
			targetId: userId,
			actorIp,
			details: {},
		});
	}

	/**
	 * Regenerates backup codes for a user who already has TOTP enrolled.
	 * Requires a valid TOTP code for verification before regenerating.
	 * Returns the new plaintext backup codes (shown once to the user).
	 * Throws if the code is invalid.
	 *
	 * Uses checkCode() directly (not verifyTotp) to bypass replay protection,
	 * for the same reason as disableTotp().
	 */
	public async regenerateBackupCodes(
		userId: string,
		code: string,
		actorIp: string
	): Promise<string[]> {
		const valid = await this.checkCode(userId, code);
		if (!valid) {
			throw new Error('mfa.invalidCode');
		}

		const { plainCodes, hashedCodes } = await this.generateBackupCodesInternal();

		await db.update(users).set({ totpBackupCodes: hashedCodes }).where(eq(users.id, userId));

		await auditService.createAuditLog({
			actorIdentifier: userId,
			actionType: 'BACKUP_CODES_REGENERATED',
			targetType: 'User',
			targetId: userId,
			actorIp,
			details: {},
		});

		return plainCodes;
	}

	/**
	 * Determines whether MFA is required for a given user login.
	 *
	 * This is the open-source rule and the whole of it: a user who has enrolled is
	 * challenged, a user who has not is let through. `AuthService` is wired to this
	 * by default in `createServer()`.
	 *
	 * The enterprise advanced-security module overrides the check via
	 * `authService.registerMfaCheck()` to add the master switch, mandatory
	 * enforcement and the grace window — it delegates here for the enrolled case
	 * and only ever widens the result, never narrows it.
	 */
	public async isMfaRequired(userId: string): Promise<MfaCheckResult> {
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { totpEnabled: true },
		});

		if (!user?.totpEnabled) {
			return { required: false };
		}

		return { required: true, enrolled: true };
	}

	/**
	 * Admin-initiated TOTP disable for a specific user.
	 * Requires NO verification code — the admin is acting on behalf of the user.
	 * Guards against disabling for a user who does not exist or does not have TOTP active.
	 * Emits a TOTP_DISABLED audit log entry with adminAction=true so the action is
	 * distinguishable from a self-initiated disable in the audit trail.
	 *
	 * Throws 'mfa.userNotFound' if the user does not exist.
	 * Throws 'mfa.notEnabled' if the target user does not have TOTP enabled.
	 */
	public async adminDisableTotp(
		targetUserId: string,
		actorId: string,
		actorIp: string
	): Promise<void> {
		const user = await db.query.users.findFirst({
			where: eq(users.id, targetUserId),
			columns: { totpEnabled: true },
		});

		if (!user) {
			throw new Error('mfa.userNotFound');
		}

		if (!user.totpEnabled) {
			throw new Error('mfa.notEnabled');
		}

		await db
			.update(users)
			.set({
				totpSecret: null,
				totpEnabled: false,
				totpEnrolledAt: null,
				totpBackupCodes: null,
			})
			.where(eq(users.id, targetUserId));

		await auditService.createAuditLog({
			actorIdentifier: actorId,
			actionType: 'TOTP_DISABLED',
			targetType: 'User',
			targetId: targetUserId,
			actorIp,
			details: { adminAction: true },
		});
	}

	/** Generates BACKUP_CODE_COUNT random uppercase hex backup codes and their bcrypt hashes. */
	private async generateBackupCodesInternal(): Promise<{
		plainCodes: string[];
		hashedCodes: string[];
	}> {
		const plainCodes: string[] = [];
		const hashedCodes: string[] = [];

		for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
			const code = randomBytes(4).toString('hex').toUpperCase(); // e.g. "A1B2C3D4"
			const hashed = await hash(code, BACKUP_CODE_BCRYPT_ROUNDS);
			plainCodes.push(code);
			hashedCodes.push(hashed);
		}

		return { plainCodes, hashedCodes };
	}
}

// Shared singleton — used by the MFA routes, by AuthService's default check, and
// by the enterprise forced-enrollment flow.
export const mfaService = new MfaService();
