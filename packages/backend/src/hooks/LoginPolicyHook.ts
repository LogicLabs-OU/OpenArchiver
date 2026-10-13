import { logger } from '../config/logger';

/**
 * Policy over which authentication methods a user may use.
 *
 * The open-source edition has no such policy: a correct password always signs
 * in. The enterprise SSO module registers a provider at startup so that an
 * administrator who has switched on "require single sign-on" can refuse
 * password logins for ordinary users while Super Admins keep theirs.
 */
export interface LoginPolicyProvider {
	/**
	 * Translation key explaining why password login is refused for this user,
	 * or null when it is allowed. The caller has already verified the password —
	 * this decides whether the method itself is acceptable, never whether the
	 * credentials were right.
	 */
	passwordLoginDenialReason(user: { id: string; email: string }): Promise<string | null>;
}

/**
 * Extension point for login policy, in the shape of {@link MfaPolicyHook}.
 *
 * Answers with the open-source default when no provider is registered, so
 * `AuthService` has a single code path across editions.
 */
export class LoginPolicyHook {
	private static provider: LoginPolicyProvider | null = null;

	/** Registers the policy provider. A second call replaces the first. */
	static register(provider: LoginPolicyProvider): void {
		this.provider = provider;
	}

	/**
	 * Whether password login is refused, and why. Defaults to allowed (null)
	 * without a provider.
	 *
	 * A provider that throws is treated as permissive, exactly like
	 * `MfaPolicyHook.isEnrollmentAllowed`: an unreachable SSO configuration must
	 * never lock password users out of an instance whose identity provider may
	 * itself be the thing that is broken.
	 */
	static async passwordLoginDenialReason(user: {
		id: string;
		email: string;
	}): Promise<string | null> {
		if (!this.provider) return null;
		try {
			return await this.provider.passwordLoginDenialReason(user);
		} catch (error) {
			logger.error(
				`Login policy provider failed on passwordLoginDenialReason for ${user.id}:`,
				error
			);
			return null;
		}
	}
}
