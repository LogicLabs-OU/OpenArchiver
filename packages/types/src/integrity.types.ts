export interface IntegrityCheckResult {
	type: 'email' | 'attachment';
	id: string;
	filename?: string;
	isValid: boolean;
	reason?: string;
	/** SHA-256 hash stored at archival time. */
	storedHash: string;
	/** SHA-256 hash computed during this verification. */
	computedHash: string;
}
