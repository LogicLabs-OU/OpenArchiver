import type { PolicyStatement } from '@open-archiver/types';
import { ValidActions, ValidResourcePatterns } from './iam-definitions';

/**
 * @class PolicyValidator
 *
 * This class provides a static method to validate an IAM policy statement.
 * It is designed to be used before a policy is saved to the database, ensuring that
 * only valid and well-formed policies are stored.
 *
 * The verification logic is based on the centralized definitions in `iam-definitions.ts`.
 */
export class PolicyValidator {
	/**
	 * Validates a single policy statement to ensure its actions and resources are valid.
	 *
	 * @param {PolicyStatement} statement - The policy statement to validate.
	 * @returns {{valid: boolean; reason?: string}} - An object containing a boolean `valid` property
	 * and an optional `reason` string if validation fails.
	 */
	public static isValid(statement: PolicyStatement): { valid: boolean; reason: string } {
		if (!statement || !statement.Action || !statement.Resource || !statement.Effect) {
			return { valid: false, reason: 'Policy statement is missing required fields.' };
		}

		// 1. Validate Actions
		for (const action of statement.Action) {
			const { valid, reason } = this.isActionValid(action);
			if (!valid) {
				return { valid: false, reason };
			}
		}

		// 2. Validate Resources
		for (const resource of statement.Resource) {
			const { valid, reason } = this.isResourceValid(resource);
			if (!valid) {
				return { valid: false, reason };
			}
		}

		return { valid: true, reason: 'valid' };
	}

	/**
	 * Checks if a single action string is valid.
	 *
	 * Logic:
	 * - If the action contains a wildcard (e.g., 'archive:*'), it checks if the service part
	 *   (e.g., 'archive') is a recognized service.
	 * - If there is no wildcard, it checks if the full action string (e.g., 'archive:read')
	 *   exists in the `ValidActions` set.
	 *
	 * @param {string} action - The action string to validate.
	 * @returns {{valid: boolean; reason?: string}} - An object indicating validity and a reason for failure.
	 */
	private static isActionValid(action: string): { valid: boolean; reason: string } {
		if (action === '*') {
			return { valid: true, reason: 'valid' };
		}
		if (action.endsWith(':*')) {
			const service = action.split(':')[0];
			if (service in ValidResourcePatterns) {
				return { valid: true, reason: 'valid' };
			}
			return {
				valid: false,
				reason: `Invalid service '${service}' in action wildcard '${action}'.`,
			};
		}
		if (ValidActions.has(action)) {
			return { valid: true, reason: 'valid' };
		}
		return { valid: false, reason: `Action '${action}' is not a valid action.` };
	}

	/**
	 * Checks if a single resource string has a valid format.
	 *
	 * Logic:
	 * - It extracts the service name from the resource string (e.g., 'archive' from 'archive/all').
	 * - It looks up the corresponding regular expression for that service in `ValidResourcePatterns`.
	 * - It tests the resource string against the pattern. If the service does not exist or the
	 *   pattern does not match, the resource is considered invalid.
	 *
	 * @param {string} resource - The resource string to validate.
	 * @returns {{valid: boolean; reason?: string}} - An object indicating validity and a reason for failure.
	 */
	private static isResourceValid(resource: string): { valid: boolean; reason: string } {
		if (resource === '*') {
			return { valid: true, reason: 'valid' };
		}

		for (const service in ValidResourcePatterns) {
			const pattern = ValidResourcePatterns[service as keyof typeof ValidResourcePatterns];
			if (pattern.test(resource)) {
				return { valid: true, reason: 'valid' };
			}
		}

		return { valid: false, reason: `Resource '${resource}' does not match any valid resource format.` };
	}
}
