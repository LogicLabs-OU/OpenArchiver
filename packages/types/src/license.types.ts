/**
 * Features of Open Archiver Enterprise
 */
export enum OpenArchiverFeature {
	AUDIT_LOG = 'audit-log',
	RETENTION_POLICY = 'retention-policy',
	LEGAL_HOLDS = 'legal-holds',
	INTEGRITY_REPORT = 'integrity-report',
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
}

/**
 * The structure of the locally cached license-status.json file.
 * Written after each successful phone-home call.
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
}
