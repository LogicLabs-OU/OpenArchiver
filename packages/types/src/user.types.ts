import { CaslPolicy } from './iam.types';

/**
 * Represents a user account in the system.
 * This is the core user object that will be stored in the database.
 */
export interface User {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	role: Role | null;
	createdAt: Date;
	/** Whether TOTP two-factor authentication is currently enabled for this user. */
	totpEnabled: boolean;
	/**
	 * How this account authenticates: 'local' (password), 'oidc' or 'saml'.
	 * SSO-provisioned accounts have no password, and the UI hides password
	 * management for them.
	 */
	provider: string | null;
	/**
	 * Whether a password is set. Optional because only the user projections in
	 * UserService compute it; synthetic actors and older call sites omit it.
	 * The distinction matters for linked accounts: `provider` says 'oidc' or
	 * 'saml' after auto-link, but the original password remains a working
	 * credential, and hiding password management for it would leave a live
	 * credential nobody can rotate.
	 */
	hasPassword?: boolean;
}

/**
 * Represents a user's session.
 * This is used to track a user's login status.
 */
export interface Session {
	id: string;
	userId: string;
	expiresAt: Date;
}

/**
 * Defines a role that can be assigned to users.
 * Roles are used to group a set of permissions together.
 */
export interface Role {
	id: string;
	slug: string | null;
	name: string;
	policies: CaslPolicy[];
	createdAt: Date;
	updatedAt: Date;
}

export interface ApiKey {
	id: string;
	name: string;
	key: string;
	expiresAt: string;
	createdAt: string;
}
