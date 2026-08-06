import { logger } from '../config/logger';

export type DeletionCheck = (emailId: string) => Promise<boolean>;

export class RetentionHook {
	private static checks: DeletionCheck[] = [];

	/**
	 * Registers a function that checks if an email can be deleted.
	 * The function should return true if deletion is allowed, false otherwise.
	 */
	static registerCheck(check: DeletionCheck) {
		this.checks.push(check);
	}

	/**
	 * Verifies if an email can be deleted by running all registered checks.
	 * If ANY check returns false, deletion is blocked.
	 */
	static async canDelete(emailId: string): Promise<boolean> {
		for (const check of this.checks) {
			try {
				const allowed = await check(emailId);
				if (!allowed) {
					logger.info(`Deletion blocked by retention check for email ${emailId}`);
					return false;
				}
			} catch (error) {
				logger.error(`Error in retention check for email ${emailId}:`, error);
				// Fail safe: if a check errors, assume we CANNOT delete to be safe
				return false;
			}
		}
		return true;
	}
}
