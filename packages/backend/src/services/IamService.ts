import { db } from '../database';
import { roles, userRoles, users } from '../database/schema/users';
import type { Role, CaslPolicy, User } from '@open-archiver/types';
import { eq } from 'drizzle-orm';
import { createAbilityFor, AppAbility } from '../iam-policy/ability';

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

	public async createRole(name: string, policy: CaslPolicy[], slug?: string): Promise<Role> {
		const [role] = await db
			.insert(roles)
			.values({
				name: name,
				slug: slug || name.toLocaleLowerCase().replaceAll('', '_'),
				policies: policy,
			})
			.returning();
		return role;
	}

	public async deleteRole(id: string): Promise<void> {
		await db.delete(roles).where(eq(roles.id, id));
	}

	public async updateRole(
		id: string,
		{ name, policies }: Partial<Pick<Role, 'name' | 'policies'>>
	): Promise<Role> {
		const [role] = await db
			.update(roles)
			.set({ name, policies })
			.where(eq(roles.id, id))
			.returning();
		return role;
	}

	public async getAbilityForUser(userId: string): Promise<AppAbility> {
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
		});

		if (!user) {
			// Or handle this case as you see fit, maybe return an ability with no permissions
			throw new Error('User not found');
		}

		const userRoles = await this.getRolesForUser(userId);
		const allPolicies = userRoles.flatMap((role) => role.policies || []);
		// Interpolate policies
		const interpolatedPolicies = this.interpolatePolicies(allPolicies, {
			...user,
			role: null,
		} as User);
		return createAbilityFor(interpolatedPolicies);
	}

	private interpolatePolicies(policies: CaslPolicy[], user: User): CaslPolicy[] {
		const userPoliciesString = JSON.stringify(policies);
		const interpolatedPoliciesString = userPoliciesString.replace(/\$\{user\.id\}/g, user.id);
		return JSON.parse(interpolatedPoliciesString);
	}
}
