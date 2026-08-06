/**
 * Discriminated result from MfaService.isMfaRequired().
 * Used by AuthService.login() to determine how to respond to a login attempt.
 */
export type MfaCheckResult =
	| { required: false }
	| { required: true; enrolled: true }
	| { required: true; enrolled: false; gracePeriodExpired: boolean };

/**
 * Defines the organization-wide advanced security policy.
 * Stored in `system_settings` as a JSON blob under the key `advanced_security_policy`.
 */
export interface AdvancedSecurityPolicy {
	/** Master switch — is TOTP 2FA available for users to enroll? */
	totpEnabled: boolean;
	/** If true, all users MUST enroll in 2FA. */
	totpEnforced: boolean;
	/** Number of days after enforcement before unenrolled users are blocked from login. */
	gracePeriodDays: number;
	/** ISO 8601 timestamp of when enforcement was activated. Null if not enforced. */
	enforcedAt: string | null;
}

/** Returned by GET /enterprise/advanced-security/mfa/status */
export interface MfaStatus {
	/** Whether TOTP is currently enabled for the user. */
	totpEnabled: boolean;
	/** ISO 8601 timestamp of when TOTP was enrolled. Null if not enrolled. */
	enrolledAt: string | null;
	/**
	 * ISO 8601 deadline by which this user must enroll in 2FA.
	 * Only present when enforcement is active and the user has NOT yet enrolled.
	 * Null when enforcement is off, already enrolled, or the feature is disabled.
	 *
	 * Formula: max(enforcedAt, user.createdAt) + gracePeriodDays
	 * - Existing users: deadline starts from when enforcement was activated.
	 * - New users (created after enforcement): deadline starts from account creation.
	 */
	graceDeadline: string | null;
}

/** Returned by POST /enterprise/advanced-security/mfa/setup */
export interface MfaSetupResponse {
	/** The otpauth:// URI for manual entry into an authenticator app. */
	otpAuthUrl: string;
	/** A data URL of the QR code image encoding the otpAuthUrl. */
	qrCodeDataUrl: string;
}

/** Returned by POST /enterprise/advanced-security/mfa/enroll */
export interface MfaEnrollResponse {
	/** Single-use backup codes. Shown only once — user must save them. */
	backupCodes: string[];
}

/** Request body for POST /v1/auth/mfa/verify */
export interface MfaVerifyRequest {
	/** The short-lived JWT issued after successful password authentication. */
	mfaPendingToken: string;
	/** The 6-digit TOTP code or a backup code. */
	code: string;
}
