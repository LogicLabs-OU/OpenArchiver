import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SsoGroupMapping, SsoProtocol } from '@open-archiver/types';
import { roles } from './users';

/**
 * Identity-provider connections for enterprise single sign-on.
 *
 * The table ships in the open-source migration chain because the chain is unified
 * here, in the same way `journaling_sources` and the compliance tables do. No
 * open-source code reads it — every consumer lives in `packages/enterprise`, so on
 * an open-source deployment the table simply stays empty.
 */
export const ssoConnections = pgTable('sso_connections', {
	id: uuid('id').primaryKey().defaultRandom(),
	/** Display name, shown on the sign-in button ("Continue with {name}"). */
	name: text('name').notNull(),
	protocol: text('protocol').$type<SsoProtocol>().notNull(),
	enabled: boolean('enabled').notNull().default(false),
	/** OIDC: issuer URL used for discovery. SAML: the IdP entity id. */
	issuer: text('issuer').notNull(),
	/** OIDC client id. Null on SAML connections, which authenticate by certificate. */
	clientId: text('client_id'),
	/**
	 * OIDC client secret, encrypted with `CryptoService` exactly like `api_keys.key`
	 * and the ingestion credentials. Decrypted only inside the token exchange.
	 */
	clientSecret: text('client_secret'),
	/** SAML IdP metadata XML or signing certificate. Populated in phase 3. */
	samlIdpMetadata: text('saml_idp_metadata'),
	/**
	 * Email-domain allowlist. Mandatory for both JIT provisioning and account
	 * linking: an assertion carrying an address outside these domains is refused
	 * even when a local account matches it, so an IdP administrator cannot claim
	 * arbitrary existing accounts.
	 */
	emailDomains: jsonb('email_domains')
		.$type<string[]>()
		.notNull()
		.default(sql`'[]'::jsonb`),
	/** Create an account on first SSO login when no matching user exists. */
	jitEnabled: boolean('jit_enabled').notNull().default(true),
	/** Attach SSO to an existing local account matched by normalized email. */
	autoLink: boolean('auto_link').notNull().default(true),
	/** Role granted when no group mapping matches. */
	defaultRoleId: uuid('default_role_id').references(() => roles.id, { onDelete: 'set null' }),
	/** Name of the ID-token claim or SAML attribute carrying group values. */
	groupsClaim: text('groups_claim').notNull().default('groups'),
	groupMappings: jsonb('group_mappings')
		.$type<SsoGroupMapping[]>()
		.notNull()
		.default(sql`'[]'::jsonb`),
	/** Re-apply group mappings on every login, so IdP group moves take effect. */
	syncRolesOnLogin: boolean('sync_roles_on_login').notNull().default(true),
	/**
	 * Refuse password login for ordinary users. Defaults to false and is only ever
	 * set by an administrator — never as a side effect of enabling a connection.
	 * Super Admins stay exempt, which is the break-glass path out of a broken IdP.
	 */
	enforceSso: boolean('enforce_sso').notNull().default(false),
	/**
	 * Stamped on every successful SSO login. Enforcement cannot be switched on
	 * until this is set, so an administrator cannot enforce a flow that has never
	 * completed once.
	 */
	lastSuccessfulLoginAt: timestamp('last_successful_login_at', { withTimezone: true }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
