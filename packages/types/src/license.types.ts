import type { IngestionProvider } from './ingestion.types';
import type { OrganizationDomainGroup } from './journaling.types';

/**
 * Features of Open Archiver Enterprise
 */
export enum OpenArchiverFeature {
	AUDIT_LOG = 'audit-log',
	RETENTION_POLICY = 'retention-policy',
	LEGAL_HOLDS = 'legal-holds',
	INTEGRITY_REPORT = 'integrity-report',
	JOURNALING = 'journaling',
	ADVANCED_SECURITY = 'advanced-security',
	SSO = 'sso',
	STATUS = 'status',
	ALL = 'all',
}

/**
 * The payload of the offline license.jwt file.
 */
export interface LicenseFilePayload {
	licenseId: string; // UUID linking to the License Server
	customerName: string;
	planSeats: number;
	features: OpenArchiverFeature[];
	expiresAt: string; // ISO 8601
	issuedAt: string; // ISO 8601
	/**
	 * Maximum number of days enterprise features keep working without reaching the
	 * license server. Optional; defaults to 14 when absent.
	 *
	 * It lives in the signed license precisely so the customer cannot widen it.
	 * OA_LICENSE_OFFLINE_GRACE_DAYS can only lower the effective window; a
	 * deployment that legitimately needs a longer one (air-gapped sites) is
	 * issued a license carrying a larger value.
	 */
	offlineGraceDays?: number;
}

/**
 * The seat-accounting rule set this client implements.
 *
 * Sent with every seat report so the license server can tell an instance that predates a rule
 * change from one that has it. Bump it whenever the classification rules or the default role-name
 * list change in a way that moves the billable number.
 */
export const SEAT_POLICY_VERSION = 1;

/**
 * How one mailbox came to be counted, or not counted, as a seat.
 *
 * - `provider` — the directory itself said so (Microsoft userPurpose, or an unlicensed account
 *   that still owns a mailbox). Not overridable by an administrator.
 * - `pattern` — the local part is a role name (`info`, `sales`, `noreply`, …), matched exactly.
 * - `admin` — an administrator declared it.
 * - `none` — nothing is known; the mailbox counts as a seat.
 */
export type MailboxKind = 'user' | 'shared' | 'room' | 'equipment' | 'unknown';
export type MailboxKindEvidence = 'provider' | 'pattern' | 'admin' | 'none';

/**
 * Why two addresses were treated as the same person.
 *
 * - `provider` — one directory object, or one object's alias list naming the other address.
 * - `alias_domain` — same local part under two domains of one configured domain group.
 * - `admin_link` — an administrator linked them.
 * - `address` — not merged; the mailbox is its own identity.
 */
export type SeatIdentityEvidence = 'provider' | 'alias_domain' | 'admin_link' | 'address';

/**
 * The breakdown behind `LicensePingRequest.activeSeats`.
 *
 * Seats are billed per person, not per mailbox, so the reported number is smaller than the number
 * of archived mailboxes whenever shared mailboxes are excluded or two addresses are merged. This
 * report is what lets the license server see how the two numbers diverged and judge whether the
 * reductions are plausible — the client never decides that for itself.
 *
 * Counters only. Addresses are transmitted as hashes, on the ping request, never here.
 */
export interface SeatReport {
	seatPolicyVersion: number;
	/** ISO 8601 timestamp of the reconciliation that produced these numbers. */
	computedAt: string;
	/**
	 * Mailboxes that currently hold archived emails — distinct normalized
	 * `archived_emails.user_email` values, sentinels included. Mailboxes a directory lists but
	 * which have never been archived are not in this number.
	 */
	rawMailboxes: number;
	/** Billable seats: identity groups holding at least one active, person-owned mailbox. */
	seats: number;
	/**
	 * Mailboxes that are not seats, by the reason they were excluded.
	 *
	 * Every counter in this report except `inactive` covers the `rawMailboxes` population, so
	 * `provider + patternDefault + patternAdmin + admin + sentinel <= rawMailboxes` always holds.
	 * `inactive` is the one exception: registered mailboxes holding no archived emails, which sit
	 * outside `rawMailboxes` and are counted nowhere else.
	 */
	excluded: {
		provider: number;
		patternDefault: number;
		patternAdmin: number;
		admin: number;
		sentinel: number;
		inactive: number;
	};
	/**
	 * Mailboxes sharing their seat identity with at least one other address, by the strongest
	 * evidence that joined them. Every member of a merged group is counted, so one person known
	 * under two addresses adds 2, not 1.
	 */
	merged: {
		provider: number;
		aliasDomain: number;
		adminLink: number;
	};
	/** Mailboxes the provider called a user but a role-name pattern excluded anyway. */
	patternOverridesProvider: number;
	/** Mailboxes an administrator declared shared. Exact, even when the hash list is capped. */
	adminDeclaredSharedCount: number;
	/** Mailboxes an administrator linked to another (the declaring side of each link). */
	adminLinks: number;
	organizationDomainGroups: number;
	organizationDomainCount: number;
	/** Excluded mailboxes whose address matches a login account — evidence of a real person. */
	loginUserOverlap: number;
	/** Active mailboxes no directory has listed recently. Informational; still seats. */
	departed: number;
	/** Whether any Microsoft source could read mailboxSettings for the purpose signal. */
	purposeSignalAvailable: boolean;
	byProvider: Partial<Record<IngestionProvider, { mailboxes: number; seats: number }>>;
}

/**
 * The organization-wide seat policy, stored in `system_settings.config.seat_policy`.
 *
 * Both fields widen what the instance treats as "not a person". Neither can narrow it: a mailbox
 * the provider asserts is a licensed user stays a seat regardless of what is configured here, and
 * the default role names cannot be removed. Everything set here is reported to the license server.
 */
export interface SeatPolicy {
	/**
	 * Domains belonging to one organization, so `john@main.com` and `john@alias.com` are one
	 * person. Shares its shape with the journaling source setting, and the two are folded together
	 * at reconciliation so a domain configured for journaling need not be entered twice.
	 */
	organizationDomainGroups: OrganizationDomainGroup[];
	/**
	 * Extra role local parts beyond the built-in list, matched exactly (`support2` never matches
	 * `support`). Each one is an administrator declaration and is reported.
	 */
	additionalRoleLocalParts: string[];
	/** ISO 8601 timestamp of the last change. */
	updatedAt?: string;
}

/**
 * Request body sent to the license server's POST /api/v1/ping endpoint.
 */
export interface LicensePingRequest {
	/** UUID of the license, taken from the license.jwt payload. */
	licenseId: string;
	/**
	 * Billable seats on this instance — equal to `seatReport.seats` when a report is present.
	 *
	 * Kept as a plain number at the top level so a license server that predates seat accounting
	 * keeps working unchanged.
	 */
	activeSeats: number;
	/** Version string of the running Open Archiver instance. */
	version: string;
	/**
	 * How `activeSeats` was arrived at. Omitted when reconciliation failed and the instance fell
	 * back to a raw mailbox count.
	 */
	seatReport?: SeatReport;
	/**
	 * sha256 of each role local part an administrator added to the built-in list — the word
	 * `frontdesk`, never an address — sorted.
	 *
	 * Unsalted on purpose, so the vendor can test a candidate word (a personal first or last
	 * name, say) against the list. This is the only hashed value the ping carries: nothing
	 * derived from a mailbox address leaves the instance, because an unsalted hash of an address
	 * under a known domain is reversible by guessing and therefore still personal data.
	 */
	adminPatternExtensions?: string[];
	/**
	 * Unique identifier for this deployment, stored in system_settings.
	 * Optional: omitted when the database was unreachable during startup.
	 * The license server treats a missing instanceId as null and skips
	 * instance tracking for that ping (backward-compat).
	 */
	instanceId?: string;
}

/**
 * Successful response body from the license server's POST /api/v1/ping endpoint.
 *
 * - `"VALID"` — license is active. If `gracePeriodEnds` is present, seats exceed
 *   the plan limit and the grace period deadline is included.
 * - `"INVALID"` — license is revoked, not found, or the overage grace period has
 *   expired. All enterprise features must be disabled immediately.
 */
export interface LicensePingResponse {
	status: 'VALID' | 'INVALID';
	// ISO 8601 UTC timestamp.
	expirationDate: string;
	/** ISO 8601 UTC timestamp. Present only when status is "VALID" and activeSeats > planSeats. */
	gracePeriodEnds?: string;
	/** The current plan seat limit from the license server. */
	planSeats?: number;
	message?: string;
	/**
	 * True when the license server detects multiple distinct instance IDs
	 * using the same license key. Present only when the violation is active.
	 */
	instanceViolation?: boolean;
	/**
	 * True when the license server judges the instance's seat reductions implausible — too many
	 * mailboxes declared shared, too many identities merged by hand, or an excluded address that
	 * matches a login account.
	 *
	 * Advisory on the client, exactly like `instanceViolation`: it produces a warning on the admin
	 * page and nothing else. Only the vendor escalates to `status: 'INVALID'`, after review.
	 */
	seatPolicyViolation?: boolean;
	/**
	 * Compact JWS (ES256, signed with the same keypair as license.jwt) whose claims
	 * are this status payload plus licenseId, the echoed instanceId, and iat.
	 *
	 * The client stores it verbatim and derives enforcement state from the verified
	 * claims, so a locally forged "VALID" or a forged-fresh timestamp requires the
	 * license server's private key.
	 *
	 * Optional for backward compatibility: license servers that do not yet sign
	 * responses omit it, and the client falls back to the unsigned fields above.
	 */
	signedStatus?: string;
}

/**
 * The license status recorded after each successful phone-home call.
 * Persisted in system_settings.config.licenseStatus.
 */
export interface LicenseStatusPayload {
	status: 'VALID' | 'INVALID';
	/** ISO 8601 UTC timestamp. Present when the instance is in a seat-overage grace period. */
	gracePeriodEnds?: string;
	/** ISO 8601 UTC timestamp of when this status was last successfully fetched. */
	lastCheckedAt?: string;
	/** The current plan seat limit from the license server. */
	planSeats: number;
	/** ISO 8601 UTC timestamp of the license expiration date. */
	expirationDate?: string;
	/** Optional message from the license server (e.g. regarding account status). */
	message?: string;
	/** True when the license server detected concurrent use of the same key on multiple instances. */
	instanceViolation?: boolean;
	/** True when the license server judged this instance's seat reductions implausible. */
	seatPolicyViolation?: boolean;
}

/**
 * The license status record stored in system_settings.config.licenseStatus.
 *
 * `payload` is always present and is what the API and UI display. `jws` is present
 * only when the license server signed the response; when it is, enforcement reads
 * the verified claims from it rather than `payload`, so editing `payload` in the
 * database cannot grant features.
 */
export interface StoredLicenseStatus {
	jws?: string;
	payload: LicenseStatusPayload;
}

/**
 * The consolidated license status object returned by the GET /enterprise/status/license-status API.
 */
export interface ConsolidatedLicenseStatus {
	// From the license.jwt file
	customerName: string;
	planSeats: number;
	expiresAt: string;
	// From the cached license-status.json
	remoteStatus: 'VALID' | 'INVALID' | 'UNKNOWN';
	gracePeriodEnds?: string;
	lastCheckedAt?: string;
	message?: string;
	// Calculated values
	/** Billable seats, from the last reconciliation. */
	activeSeats: number;
	/** Distinct archived mailboxes behind those seats. Larger than `activeSeats` whenever shared
	 *  mailboxes were excluded or addresses were merged. */
	rawMailboxes?: number;
	/** ISO 8601 timestamp of the reconciliation the seat numbers come from. */
	seatReportComputedAt?: string;
	isExpired: boolean;
	features: {
		[key in OpenArchiverFeature]?: boolean;
	};
	/** This deployment's unique instance identifier. */
	instanceId: string;
	/** True when the license server detected concurrent use on multiple instances. */
	instanceViolation?: boolean;
	/** True when the license server judged this instance's seat reductions implausible. */
	seatPolicyViolation?: boolean;
	/**
	 * Days left before enterprise features are disabled because the license server
	 * has not been reached. Counts down from OA_LICENSE_OFFLINE_GRACE_DAYS since
	 * lastCheckedAt; 0 means the grace window has run out.
	 */
	offlineGraceDaysRemaining: number;
	/** The configured offline grace window in days. */
	offlineGraceDays: number;
}
