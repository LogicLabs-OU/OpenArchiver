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

	// Other Actions
	'SEARCH',
	'DOWNLOAD',
	'GENERATE', // For API keys
] as const;

export const AuditLogTargetTypes = [
	'ApiKey',
	'ArchivedEmail',
	'Dashboard',
	'IngestionSource',
	'Role',
	'SystemSettings',
	'User',
	'File', // For uploads and downloads
] as const;

export type AuditLogAction = (typeof AuditLogActions)[number];
export type AuditLogTargetType = (typeof AuditLogTargetTypes)[number];
