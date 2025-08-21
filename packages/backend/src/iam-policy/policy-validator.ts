import type { CaslPolicy, AppActions, AppSubjects } from '@open-archiver/types';

// Create sets of valid actions and subjects for efficient validation
const validActions: Set<AppActions> = new Set([
	'manage',
	'create',
	'read',
	'update',
	'delete',
	'search',
	'export',
	'sync',
]);

const validSubjects: Set<AppSubjects> = new Set([
	'archive',
	'ingestion',
	'settings',
	'users',
	'roles',
	'dashboard',
	'all',
]);

/**
 * @class PolicyValidator
 *
 * This class provides a static method to validate a CASL policy.
 * It is designed to be used before a policy is saved to the database, ensuring that
 * only valid and well-formed policies are stored.
 *
 * The verification logic is based on the centralized definitions in `packages/types/src/iam.types.ts`.
 */
export class PolicyValidator {
	/**
	 * Validates a single policy statement to ensure its actions and subjects are valid.
	 *
	 * @param {CaslPolicy} policy - The policy to validate.
	 * @returns {{valid: boolean; reason?: string}} - An object containing a boolean `valid` property
	 * and an optional `reason` string if validation fails.
	 */
	public static isValid(policy: CaslPolicy): { valid: boolean; reason: string } {
		if (!policy || !policy.action || !policy.subject) {
			return {
				valid: false,
				reason: 'Policy is missing required fields "action" or "subject".',
			};
		}

		// 1. Validate Actions
		const actions = Array.isArray(policy.action) ? policy.action : [policy.action];
		for (const action of actions) {
			const { valid, reason } = this.isActionValid(action);
			if (!valid) {
				return { valid: false, reason };
			}
		}

		// 2. Validate Subjects
		const subjects = Array.isArray(policy.subject) ? policy.subject : [policy.subject];
		for (const subject of subjects) {
			const { valid, reason } = this.isSubjectValid(subject);
			if (!valid) {
				return { valid: false, reason };
			}
		}

		// 3. (Optional) Validate Conditions, Fields, etc. in the future if needed.

		return { valid: true, reason: 'valid' };
	}

	/**
	 * Checks if a single action string is a valid AppAction.
	 *
	 * @param {string} action - The action string to validate.
	 * @returns {{valid: boolean; reason?: string}} - An object indicating validity and a reason for failure.
	 */
	private static isActionValid(action: AppActions): { valid: boolean; reason: string } {
		if (validActions.has(action)) {
			return { valid: true, reason: 'valid' };
		}
		return { valid: false, reason: `Action '${action}' is not a valid action.` };
	}

	/**
	 * Checks if a single subject string is a valid AppSubject.
	 *
	 * @param {string} subject - The subject string to validate.
	 * @returns {{valid: boolean; reason?: string}} - An object indicating validity and a reason for failure.
	 */
	private static isSubjectValid(subject: AppSubjects): { valid: boolean; reason: string } {
		if (validSubjects.has(subject)) {
			return { valid: true, reason: 'valid' };
		}

		return { valid: false, reason: `Subject '${subject}' is not a valid subject.` };
	}
}
