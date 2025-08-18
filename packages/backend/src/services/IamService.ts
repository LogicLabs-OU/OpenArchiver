import { db } from '../database';
import { roles, userRoles } from '../database/schema/users';
import type { Role, PolicyStatement } from '@open-archiver/types';
import { eq } from 'drizzle-orm';

export class IamService {
	/**
	 * Retrieves all roles associated with a given user.
	 * @param userId The ID of the user.
	 * @returns A promise that resolves to an array of Role objects.
	 */
	public async getRolesForUser(userId: string): Promise<Role[]> {
		const userRolesResult = await db
			.select()
			.from(userRoles)
			.where(eq(userRoles.userId, userId))
			.leftJoin(roles, eq(userRoles.roleId, roles.id));

		return userRolesResult.map((r) => r.roles).filter((r): r is Role => r !== null);
	}
	public async getRoles(): Promise<Role[]> {
		return db.select().from(roles);
	}

	public async getRoleById(id: string): Promise<Role | undefined> {
		const [role] = await db.select().from(roles).where(eq(roles.id, id));
		return role;
	}

	public async createRole(name: string, policy: PolicyStatement[]): Promise<Role> {
		const [role] = await db.insert(roles).values({ name, policies: policy }).returning();
		return role;
	}

	public async deleteRole(id: string): Promise<void> {
		await db.delete(roles).where(eq(roles.id, id));
	}
}
