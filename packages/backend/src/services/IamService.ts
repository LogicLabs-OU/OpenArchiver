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
			// Handle this case as appropraite
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
        // Convert the policies to a JSON string for a simple search/replace
        const userPoliciesString = JSON.stringify(policies);

		// Set up replacements for supported variables. We lowercase the user's email
		// so that access checks aren’t affected by case differences when matching
		// archived records. If the user’s email isn’t available, we leave the placeholder
		// as-is and log a warning.
        const replacements: Record<string, string> = {
            '${user.id}': user.id,
        };
        if (user.email) {
            // Normalize email to lower case
            replacements['${user.email}'] = user.email.toLowerCase();
        } else {
            // Log a warning when email is unavailable; 
            console.warn('IAM interpolation: user.email is undefined, leaving placeholder intact');
        }

        let interpolated = userPoliciesString;
        for (const placeholder of Object.keys(replacements)) {
			const value = replacements[placeholder];
			
            interpolated = interpolated.split(placeholder).join(value);
        }
        return JSON.parse(interpolated);
    }
}
