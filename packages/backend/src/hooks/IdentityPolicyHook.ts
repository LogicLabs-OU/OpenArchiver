import { logger } from '../config/logger';

/** The subset of an account this policy needs to judge an address change. */
export interface IdentityPolicySubject {
	id: string;
	email: string;
	provider: string | null;
}

/**
 * Policy over which email addresses an account may claim.
 *
 * The open-source edition has no such policy: any address a user types is theirs
 * to take. The enterprise SSO module registers a provider so that addresses in a
 * domain an identity provider serves cannot be claimed by an ordinary user — an
 * address in that space is an identity claim, because a first sign-in links to
 * whatever local account already holds the asserted address.
 */
export interface IdentityPolicyProvider {
	/**
	 * Translation key explaining why this account may not take `newEmail`, or null
	 * when it may. The caller has already established that the address is a change
	 * and that the account is not federated.
	 */
	emailChangeDenialReason(user: IdentityPolicySubject, newEmail: string): Promise<string | null>;
}

/**
 * Extension point for identity policy, in the shape of {@link LoginPolicyHook}.
 *
 * Answers with the open-source default when no provider is registered, so
 * `UserService` has a single code path across editions.
 */
export class IdentityPolicyHook {
	private static provider: IdentityPolicyProvider | null = null;

	/** Registers the policy provider. A second call replaces the first. */
	static register(provider: IdentityPolicyProvider): void {
		this.provider = provider;
	}

	/**
	 * Whether this account may take the address, and why not.
	 *
	 * A provider that throws fails **closed** here, which is the opposite of
	 * `LoginPolicyHook.passwordLoginDenialReason` and deliberate. Failing open on
	 * a login policy keeps password users out of a lockout when the identity
	 * provider is itself what broke; failing open here would hand out an identity
	 * claim on a database hiccup. Refusing one profile edit costs far less.
	 */
	static async emailChangeDenialReason(
		user: IdentityPolicySubject,
		newEmail: string
	): Promise<string | null> {
		if (!this.provider) return null;
		try {
			return await this.provider.emailChangeDenialReason(user, newEmail);
		} catch (error) {
			logger.error(
				{ err: error, userId: user.id },
				'Identity policy provider failed on emailChangeDenialReason; refusing the change'
			);
			return 'user.emailReservedByIdp';
		}
	}
}
