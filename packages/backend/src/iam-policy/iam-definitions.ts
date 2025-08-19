/**
 * @file This file serves as the single source of truth for all Identity and Access Management (IAM)
 * definitions within Open Archiver. Centralizing these definitions is an industry-standard practice
 * that offers several key benefits:
 *
 * 1.  **Prevents "Magic Strings"**: Avoids the use of hardcoded strings for actions and resources
 *     throughout the codebase, reducing the risk of typos and inconsistencies.
 * 2.  **Single Source of Truth**: Provides a clear, comprehensive, and maintainable list of all
 *     possible permissions in the system.
 * 3.  **Enables Validation**: Allows for the creation of a robust validation function that can
 *     programmatically check if a policy statement is valid before it is saved.
 * 4.  **Simplifies Auditing**: Makes it easy to audit and understand the scope of permissions
 *     that can be granted.
 *
 * The structure is inspired by AWS IAM, using a `service:operation` format for actions and a
 * hierarchical, slash-separated path for resources.
 */

/**
 * Possible action verbs: 
	- CRUD: read, update, create, delete
	- Special: export, search, manage, assign

	Resource ranges:
	- * : all resources 
	- own: resources owned by / created by the requesting user
	- {{id}}: resource with certain ID
 */

/**
 * Rules:
 * 	- If a user has access to upper level resource, it has access to resources that depends on it. eg: If a user has access to ingestion XYZ, it will have access to all the archived emails created by ingestion XYZ. The permission should be inherent: if the user can delete ingestion XYZ, it can delete archived emails created by ingestion XYZ.
 * 	2. 
 * 
 */


// ===================================================================================
// SERVICE: archive
// ===================================================================================

const ARCHIVE_ACTIONS = {
	READ: 'archive:read',
	SEARCH: 'archive:search',
	DELETE: 'archive:delete',
	EXPORT: 'archive:export',
};

const ARCHIVE_RESOURCES = {
	ALL: 'archive/*',
	INGESTION: 'archive/ingestion/*',
	MAILBOX: 'archive/mailbox/{email}', //Scopes the action to a single, specific mailbox, usually identified by an email address. |
	CUSTODIAN: 'archive/custodian/{custodianId}',// Scopes the action to emails belonging to a specific custodian.     
};

// ===================================================================================
// SERVICE: ingestion
// ===================================================================================

const INGESTION_ACTIONS = {
	CREATE_SOURCE: 'ingestion:create',
	READ_SOURCE: 'ingestion:read',
	UPDATE_SOURCE: 'ingestion:update',
	DELETE_SOURCE: 'ingestion:delete',
	MANAGE_SYNC: 'ingestion:manage', // Covers triggering, pausing, and forcing syncs
};

const INGESTION_RESOURCES = {
	ALL: 'ingestion/*',
	SOURCE: 'ingestion/{sourceId}',
	OWN: 'ingestion/own',
};

// ===================================================================================
// SERVICE: system
// ===================================================================================

const SYSTEM_ACTIONS = {
	READ_SETTINGS: 'settings:read',
	UPDATE_SETTINGS: 'settings:update',
	READ_USERS: 'users:read',
	CREATE_USER: 'users:create',
	UPDATE_USER: 'users:update',
	DELETE_USER: 'users:delete',
	ASSIGN_ROLE: 'roles:assign',
	UPDATE_ROLE: 'roles:update',
	CREATE_ROLE: 'roles:create',
	DELETE_ROLE: 'roles:delete',
	READ_ROLES: 'system:read',
};

const SYSTEM_RESOURCES = {
	ALL_SETTINGS: 'system/settings/*',
	ALL_USERS: 'system/users/*',
	USER: 'system/user/{userId}',
	ALL_ROLES: 'system/roles/*'
};

// ===================================================================================
// SERVICE: dashboard
// ===================================================================================

const DASHBOARD_ACTIONS = {
	READ: 'dashboard:read',
};

const DASHBOARD_RESOURCES = {
	ALL: 'dashboard/*',
};

// ===================================================================================
// EXPORTED DEFINITIONS
// ===================================================================================

/**
 * A comprehensive set of all valid IAM actions in the system.
 * This is used by the policy validator to ensure that any action in a policy is recognized.
 */
export const ValidActions: Set<string> = new Set([
	...Object.values(ARCHIVE_ACTIONS),
	...Object.values(INGESTION_ACTIONS),
	...Object.values(SYSTEM_ACTIONS),
	...Object.values(DASHBOARD_ACTIONS),
]);

/**
 * An object containing regular expressions for validating resource formats.
 * The validator uses these patterns to ensure that resource strings in a policy
 * conform to the expected structure.
 *
 * Logic:
 * - The key represents the service (e.g., 'archive').
 * - The value is a RegExp that matches all valid resource formats for that service.
 * - This allows for flexible validation. For example, `archive/*` is a valid pattern,
 *   as is `archive/email/123-abc`.
 */
export const ValidResourcePatterns = {
	archive: /^archive\/(\*|ingestion\/[^\/]+|mailbox\/[^\/]+|custodian\/[^\/]+)$/,
	ingestion: /^ingestion\/(\*|own|[^\/]+)$/,
	system: /^system\/(settings|users|user\/[^\/]+)$/,
	dashboard: /^dashboard\/\*$/,
};
