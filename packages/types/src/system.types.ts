export type SupportedLanguage =
	| 'en' // English
	| 'es' // Spanish
	| 'fr' // French
	| 'de' // German
	| 'it' // Italian
	| 'pt' // Portuguese
	| 'nl' // Dutch
	| 'ja' // Japanese
	| 'et' // Estonian
	| 'el' // Greek
	| 'bg'; // Bulgarian

export type Theme = 'light' | 'dark' | 'system';

import type { AdvancedSecurityPolicy } from './security.types';
import type { StoredLicenseStatus } from './license.types';

/**
 * The subset of system settings exposed by the API.
 *
 * GET /v1/settings/system is intentionally unauthenticated, and the payload is
 * embedded in every page load — so it must never carry deployment identity,
 * license state, or the security policy, all of which share the same DB column.
 */
export interface PublicSystemSettings {
	language: SupportedLanguage;
	theme: Theme;
	supportEmail: string | null;
}

export interface SystemSettings {
	/** The default display language for the application UI. */
	language: SupportedLanguage;

	/** The default color theme for the application. */
	theme: Theme;

	/** A public-facing email address for user support inquiries. */
	supportEmail: string | null;

	/**
	 * Enterprise advanced security policy (TOTP enforcement, grace period, etc.).
	 * Only written and read by the enterprise advanced-security module.
	 * Absent on OSS instances.
	 */
	advanced_security_policy?: AdvancedSecurityPolicy;

	/**
	 * A unique UUID identifying this deployment instance.
	 * Generated once on first enterprise startup and persisted.
	 * Used by the license phone-home to detect concurrent usage of the same key.
	 */
	instanceId?: string;

	/**
	 * The last license status received from the license server.
	 * Stored here rather than in a file next to the compiled code so that it
	 * survives restarts and image upgrades, and so every horizontally-scaled
	 * node shares one verdict.
	 * Only written and read by the enterprise license module. Absent on OSS.
	 */
	licenseStatus?: StoredLicenseStatus;
}
