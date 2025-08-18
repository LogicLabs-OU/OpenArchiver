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

// ===================================================================================
// SERVICE: archive
// ===================================================================================

const ARCHIVE_ACTIONS = {
	READ: 'archive:read',
	SEARCH: 'archive:search',
	EXPORT: 'archive:export',
} as const;

const ARCHIVE_RESOURCES = {
	ALL: 'archive/all',
	INGESTION_SOURCE: 'archive/ingestion-source/*',
	MAILBOX: 'archive/mailbox/*',
	CUSTODIAN: 'archive/custodian/*',
} as const;

// ===================================================================================
// SERVICE: ingestion
// ===================================================================================

const INGESTION_ACTIONS = {
	CREATE_SOURCE: 'ingestion:createSource',
	READ_SOURCE: 'ingestion:readSource',
	UPDATE_SOURCE: 'ingestion:updateSource',
	DELETE_SOURCE: 'ingestion:deleteSource',
	MANAGE_SYNC: 'ingestion:manageSync', // Covers triggering, pausing, and forcing syncs
} as const;

const INGESTION_RESOURCES = {
	ALL: 'ingestion-source/*',
	SOURCE: 'ingestion-source/{sourceId}',
	USER_OWNED: 'ingestion-source/user/{userId}',
} as const;

// ===================================================================================
// SERVICE: system
// ===================================================================================

const SYSTEM_ACTIONS = {
	READ_SETTINGS: 'system:readSettings',
	UPDATE_SETTINGS: 'system:updateSettings',
	READ_USERS: 'system:readUsers',
	CREATE_USER: 'system:createUser',
	UPDATE_USER: 'system:updateUser',
	DELETE_USER: 'system:deleteUser',
	ASSIGN_ROLE: 'system:assignRole',
	DELETE_ROLE: 'system:deleteRole',
} as const;

const SYSTEM_RESOURCES = {
	SETTINGS: 'system/settings',
	USERS: 'system/users',
	USER: 'system/user/{userId}',
} as const;

// ===================================================================================
// SERVICE: dashboard
// ===================================================================================

const DASHBOARD_ACTIONS = {
	READ: 'dashboard:read',
} as const;

const DASHBOARD_RESOURCES = {
	ALL: 'dashboard/*',
} as const;

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
	archive: /^archive\/(all|ingestion-source\/[^\/]+|mailbox\/[^\/]+|custodian\/[^\/]+)$/,
	ingestion: /^ingestion-source\/(\*|[^\/]+|user\/[^\/]+)$/,
	system: /^system\/(settings|users|user\/[^\/]+)$/,
	dashboard: /^dashboard\/\*$/,
};
