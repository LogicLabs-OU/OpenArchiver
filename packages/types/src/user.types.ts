import { CaslPolicy } from './iam.types';

/**
 * Represents a user account in the system.
 * This is the core user object that will be stored in the database.
 */
export interface User {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string;
	role: Role | null;
	createdAt: Date;
}

/**
 * Represents a user's session.
 * This is used to track a user's login status.
 */
export interface Session {
	id: string;
	userId: string;
	expiresAt: Date;
}

/**
 * Defines a role that can be assigned to users.
 * Roles are used to group a set of permissions together.
 */
export interface Role {
	id: string;
	slug: string | null;
	name: string;
	policies: CaslPolicy[];
	createdAt: Date;
	updatedAt: Date;
}
