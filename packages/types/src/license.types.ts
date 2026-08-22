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
 * Request body sent to the license server's POST /api/v1/ping endpoint.
 */
export interface LicensePingRequest {
	/** UUID of the license, taken from the license.jwt payload. */
	licenseId: string;
	/** Current number of unique archived mailboxes on this instance. */
	activeSeats: number;
	/** Version string of the running Open Archiver instance. */
	version: string;
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
	activeSeats: number;
	isExpired: boolean;
	features: {
		[key in OpenArchiverFeature]?: boolean;
	};
	/** This deployment's unique instance identifier. */
	instanceId: string;
	/** True when the license server detected concurrent use on multiple instances. */
	instanceViolation?: boolean;
	/**
	 * Days left before enterprise features are disabled because the license server
	 * has not been reached. Counts down from OA_LICENSE_OFFLINE_GRACE_DAYS since
	 * lastCheckedAt; 0 means the grace window has run out.
	 */
	offlineGraceDaysRemaining: number;
	/** The configured offline grace window in days. */
	offlineGraceDays: number;
}
