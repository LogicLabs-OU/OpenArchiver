/**
 * Types for enterprise single sign-on (OIDC and SAML 2.0).
 *
 * The feature is enterprise-exclusive: only `packages/enterprise` reads these at
 * runtime, but the shapes live here so the shared frontend and the backend schema
 * agree on them.
 */

export type SsoProtocol = 'oidc' | 'saml';

/** Maps one IdP group value to one Open Archiver role. */
export interface SsoGroupMapping {
	/** Group value exactly as it appears in the IdP claim or SAML attribute. */
	group: string;
	/** Open Archiver role id to grant when the group is present. */
	roleId: string;
}

/**
 * One identity-provider connection, as served to the admin page.
 *
 * The client secret is deliberately absent: it is write-only through the API and
 * never leaves the server after creation.
 */
export interface SsoConnection {
	id: string;
	name: string;
	protocol: SsoProtocol;
	enabled: boolean;
	/** OIDC: the issuer URL used for discovery. SAML: the IdP entity id. */
	issuer: string;
	/** OIDC client id. Null for SAML connections. */
	clientId: string | null;
	/** Whether a client secret is stored. The value itself is never returned. */
	hasClientSecret: boolean;
	/**
	 * SAML only: pasted IdP metadata XML for air-gapped identity providers. When
	 * present it wins over fetching the metadata from `issuer`. Not a secret —
	 * IdP metadata is a published document — so unlike the client secret it
	 * round-trips through the admin form.
	 */
	samlIdpMetadata: string | null;
	/**
	 * Email-domain allowlist. Mandatory for JIT provisioning and account linking:
	 * an assertion for an address outside these domains is refused outright.
	 */
	emailDomains: string[];
	/** Create an account on first SSO login when no matching user exists. */
	jitEnabled: boolean;
	/** Attach SSO to an existing local account matched by normalized email. */
	autoLink: boolean;
	/** Role granted when no group mapping matches. Null = refuse unmapped users without a default. */
	defaultRoleId: string | null;
	/** Name of the ID-token claim / SAML attribute carrying group values. */
	groupsClaim: string;
	groupMappings: SsoGroupMapping[];
	/** Re-apply group mappings on every login, so IdP group moves take effect. */
	syncRolesOnLogin: boolean;
	/**
	 * Refuse password login for ordinary users while this connection is enabled.
	 * Always false unless an administrator switches it on; Super Admins are exempt
	 * as the break-glass path.
	 */
	enforceSso: boolean;
	/** Set on every successful SSO login. Enforcement can only be enabled once this exists. */
	lastSuccessfulLoginAt: string | null;
	/**
	 * Accounts currently bound to this connection. Deleting it releases them back to
	 * local ownership, so the admin page states the number before asking.
	 */
	boundUserCount: number;
	/**
	 * Of those, the accounts holding no password — provisioned by this connection and
	 * with no other way in. Deleting it leaves them unable to sign in until a
	 * connection covering their address exists again.
	 */
	passwordlessUserCount: number;
	createdAt: string;
	updatedAt: string;
}

/** Payload accepted by the create/update admin endpoints. */
export interface SsoConnectionInput {
	name: string;
	protocol: SsoProtocol;
	enabled: boolean;
	issuer: string;
	clientId?: string | null;
	/** Write-only. Omit to keep the stored secret unchanged on update. */
	clientSecret?: string | null;
	/** SAML only: pasted IdP metadata XML. Null clears it. */
	samlIdpMetadata?: string | null;
	emailDomains: string[];
	jitEnabled: boolean;
	autoLink: boolean;
	defaultRoleId?: string | null;
	groupsClaim?: string;
	groupMappings?: SsoGroupMapping[];
	syncRolesOnLogin?: boolean;
	enforceSso?: boolean;
}

/**
 * Unauthenticated projection for the signin page — no secrets, no mappings,
 * no domains. Served by GET /v1/enterprise/sso/public.
 */
export interface PublicSsoConfig {
	enabled: boolean;
	/** True when any enabled connection enforces SSO for ordinary users. */
	enforced: boolean;
	connections: {
		id: string;
		name: string;
		protocol: SsoProtocol;
	}[];
}

/** Result of the admin Test button: can the IdP be reached and understood? */
export interface SsoConnectionTestResult {
	ok: boolean;
	message: string;
	/** Endpoint summary from discovery/metadata when the test succeeds. */
	details?: {
		authorizationEndpoint?: string;
		tokenEndpoint?: string;
		jwksUri?: string;
		/** SAML: the IdP single sign-on URL found in its metadata. */
		entryPoint?: string;
		/** SAML: how many signing certificates the metadata carries. */
		certificateCount?: number;
	};
}
