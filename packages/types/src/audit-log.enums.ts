export const AuditLogActions = [
	// General CRUD
	'CREATE',
	'READ',
	'UPDATE',
	'DELETE',

	// User & Session Management
	'LOGIN',
	'LOGOUT',
	'SETUP', // Initial user setup

	// Ingestion Actions
	'IMPORT',
	'PAUSE',
	'SYNC',
	'UPLOAD',
	'REINDEX',

	// Other Actions
	'SEARCH',
	'DOWNLOAD',
	'GENERATE', // For API keys

	// MFA Actions
	'TOTP_ENROLLED',
	'TOTP_DISABLED',
	'MFA_VERIFY_SUCCESS',
	'MFA_VERIFY_FAIL',
	'BACKUP_CODE_USED',
	'BACKUP_CODES_REGENERATED',
	'SECURITY_POLICY_UPDATED',
] as const;

export const AuditLogTargetTypes = [
	'ApiKey',
	'ArchivedEmail',
	'Dashboard',
	'IngestionSource',
	'JournalingSource',
	'RetentionPolicy',
	'RetentionLabel',
	'LegalHold',
	'Role',
	'SystemEvent',
	'SystemSettings',
	'User',
	'File', // For uploads and downloads
	'SecurityPolicy',
] as const;

export type AuditLogAction = (typeof AuditLogActions)[number];
export type AuditLogTargetType = (typeof AuditLogTargetTypes)[number];
