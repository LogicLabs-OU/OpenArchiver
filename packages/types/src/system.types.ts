/**
 * Every UI language the app ships. One list, so the type, the settings validation and the
 * OpenAPI schema cannot drift apart.
 */
export const SUPPORTED_LANGUAGES = [
	'en', // English
	'es', // Spanish
	'fr', // French
	'de', // German
	'it', // Italian
	'pt', // Portuguese
	'nl', // Dutch
	'ja', // Japanese
	'et', // Estonian
	'el', // Greek
	'bg', // Bulgarian
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type Theme = 'light' | 'dark' | 'system';

/**
 * How dates and times are shown across the app, chosen by an administrator for everyone.
 * - `language`: the conventions of the app's language setting (the default).
 * - `iso`: ISO 8601 — `2026-10-14`, and `2026-10-14T10:00:00+02:00` for date and time, in the
 *   viewer's local time with its UTC offset, so the same instant reads the same for everyone.
 * - `eu`: `DD/MM/YYYY`.
 * - `us`: `MM/DD/YYYY`.
 */
export type DateFormat = 'language' | 'iso' | 'eu' | 'us';

import type { AdvancedSecurityPolicy } from './security.types';
import type { SeatPolicy, SeatReport, StoredLicenseStatus } from './license.types';

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
	dateFormat?: DateFormat;
}

export interface SystemSettings {
	/** The default display language for the application UI. */
	language: SupportedLanguage;

	/** The default color theme for the application. */
	theme: Theme;

	/** A public-facing email address for user support inquiries. */
	supportEmail: string | null;

	/** How dates are shown to every user. Absent on rows saved before it existed: `language`. */
	dateFormat?: DateFormat;

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

	/**
	 * Organization-wide seat accounting policy: domain groups and extra role names.
	 * Written by the seats API in the open-source backend; the enterprise licence module only
	 * reads it. Absent until an administrator saves the policy.
	 */
	seat_policy?: SeatPolicy;

	/**
	 * The last computed seat breakdown, so every node and the admin page read one snapshot
	 * instead of each recomputing it. Counters only — no addresses — because this row is read
	 * on every page load.
	 * Written by the seats engine in the open-source backend on every reconciliation; the
	 * enterprise licence module only reads it. Absent until the first reconciliation.
	 */
	seat_report?: SeatReport;
}
