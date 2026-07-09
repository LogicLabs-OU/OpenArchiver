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
	| 'el'; // Greek

export type Theme = 'light' | 'dark' | 'system';

import type { AdvancedSecurityPolicy } from './security.types';

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
}
