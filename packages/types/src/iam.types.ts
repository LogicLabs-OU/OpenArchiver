// Define all possible actions and subjects for type safety
export type AppActions =
	| 'manage'
	| 'create'
	| 'read'
	| 'update'
	| 'delete'
	| 'search'
	| 'export'
	| 'assign'
	| 'sync';

export type AppSubjects =
	| 'archive'
	| 'ingestion'
	| 'settings'
	| 'users'
	| 'roles'
	| 'dashboard'
	| 'all';

// This structure will be stored in the `roles.policies` column
export interface CaslPolicy {
	action: AppActions | AppActions[];
	subject: AppSubjects | AppSubjects[];
	/**
	 * Conditions will be written using MongoDB query syntax (e.g., { status: { $in: ['active'] } })
	 * This leverages the full power of CASL's ucast library.
	 */
	conditions?: Record<string, any>;
	fields?: string[];
	inverted?: boolean; // true represents a 'Deny' effect
	reason?: string;
}
