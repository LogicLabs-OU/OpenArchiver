import { logger } from '../config/logger';

/**
 * The organisation-wide policy layered on top of self-service 2FA.
 *
 * The open-source edition has no policy: every user may enrol, and nobody is
 * given a deadline. The enterprise advanced-security module registers a
 * provider at startup to add the master switch and the enforcement window.
 */
export interface MfaPolicyProvider {
	/** Whether users may enrol in TOTP at all. False disables the feature outright. */
	isEnrollmentAllowed(): Promise<boolean>;
	/**
	 * ISO 8601 deadline by which this user must enrol, or null when no deadline
	 * applies — enforcement off, user already enrolled, or feature disabled.
	 */
	getGraceDeadline(userId: string): Promise<string | null>;
}

/**
 * Extension point for MFA policy, in the shape of {@link RetentionHook}.
 *
 * Both accessors answer with the open-source default when no provider is
 * registered, so `MfaService` has a single code path across editions.
 */
export class MfaPolicyHook {
	private static provider: MfaPolicyProvider | null = null;

	/** Registers the policy provider. A second call replaces the first. */
	static register(provider: MfaPolicyProvider): void {
		this.provider = provider;
	}

	/**
	 * Whether enrolment is permitted. Defaults to true without a provider.
	 *
	 * A provider that throws is treated as permissive: an unreachable policy
	 * store must not lock users out of setting up 2FA. This is the opposite of
	 * `RetentionHook`'s fail-safe, because the risk runs the other way — the
	 * cost here is a user enrolling while the switch is off, not data loss.
	 */
	static async isEnrollmentAllowed(): Promise<boolean> {
		if (!this.provider) return true;
		try {
			return await this.provider.isEnrollmentAllowed();
		} catch (error) {
			logger.error('MFA policy provider failed on isEnrollmentAllowed:', error);
			return true;
		}
	}

	/** This user's enrolment deadline. Defaults to null without a provider. */
	static async getGraceDeadline(userId: string): Promise<string | null> {
		if (!this.provider) return null;
		try {
			return await this.provider.getGraceDeadline(userId);
		} catch (error) {
			logger.error(`MFA policy provider failed on getGraceDeadline for ${userId}:`, error);
			return null;
		}
	}
}
