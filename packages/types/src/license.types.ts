/**
 * Features of Open Archiver Enterprise
 */
export enum OpenArchiverFeature {
	AUDIT_LOG = 'audit-log',
	RETENTION_POLICY = 'retention-policy',
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
 * The structure of the cached response from the License Server.
 */
export interface LicenseStatusPayload {
	status: 'VALID' | 'REVOKED';
	gracePeriodEnds?: string; // ISO 8601, only present if REVOKED
}

/**
 * The consolidated license status object returned by the API.
 */
export interface ConsolidatedLicenseStatus {
	// From the license.jwt file
	customerName: string;
	planSeats: number;
	expiresAt: string;
	// From the cached license-status.json
	remoteStatus: 'VALID' | 'REVOKED' | 'UNKNOWN';
	gracePeriodEnds?: string;
	// Calculated values
	activeSeats: number;
	isExpired: boolean;
	features: {
		[key in OpenArchiverFeature]?: boolean;
	};
}
