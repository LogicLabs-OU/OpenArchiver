import { db } from '../database';
import * as schema from '../database/schema';
import { eq, sql } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import type { PolicyStatement, User } from '@open-archiver/types';

export class UserService {
	/**
	 * Finds a user by their email address.
	 * @param email The email address of the user to find.
	 * @returns The user object if found, otherwise null.
	 */
	public async findByEmail(email: string): Promise<typeof schema.users.$inferSelect | null> {
		const user = await db.query.users.findFirst({
			where: eq(schema.users.email, email),
		});
		return user || null;
	}

	/**
	 * Finds a user by their ID.
	 * @param id The ID of the user to find.
	 * @returns The user object if found, otherwise null.
	 */
	public async findById(id: string): Promise<User | null> {
		const user = await db.query.users.findFirst({
			where: eq(schema.users.id, id),
			with: {
				userRoles: {
					with: {
						role: true
					}
				}
			}
		});
		if (!user) return null;

		return {
			...user,
			role: user.userRoles[0]?.role || null
		};
	}

	public async findAll(): Promise<User[]> {
		const users = await db.query.users.findMany({
			with: {
				userRoles: {
					with: {
						role: true
					}
				}
			}
		});

		return users.map((u) => ({
			...u,
			role: u.userRoles[0]?.role || null
		}));
	}

	public async createUser(
		userDetails: Pick<User, 'email' | 'first_name' | 'last_name'> & { password?: string },
		roleId: string
	): Promise<typeof schema.users.$inferSelect> {
		const { email, first_name, last_name, password } = userDetails;
		const hashedPassword = password ? await hash(password, 10) : undefined;

		const newUser = await db
			.insert(schema.users)
			.values({
				email,
				first_name,
				last_name,
				password: hashedPassword,
			})
			.returning();

		await db.insert(schema.userRoles).values({
			userId: newUser[0].id,
			roleId: roleId,
		});

		return newUser[0];
	}

	public async updateUser(
		id: string,
		userDetails: Partial<Pick<User, 'email' | 'first_name' | 'last_name'>>,
		roleId?: string
	): Promise<typeof schema.users.$inferSelect | null> {
		const updatedUser = await db
			.update(schema.users)
			.set(userDetails)
			.where(eq(schema.users.id, id))
			.returning();

		if (roleId) {
			await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
			await db.insert(schema.userRoles).values({
				userId: id,
				roleId: roleId,
			});
		}

		return updatedUser[0] || null;
	}

	public async deleteUser(id: string): Promise<void> {
		await db.delete(schema.users).where(eq(schema.users.id, id));
	}

	/**
	 * Creates an admin user in the database. The user created will be assigned the 'Super Admin' role.
	 *
	 * Caution ⚠️: This action can only be allowed in the initial setup
	 *
	 * @param userDetails The details of the user to create.
	 * @param isSetup Is this an initial setup?
	 * @returns The newly created user object.
	 */
	public async createAdminUser(
		userDetails: Pick<User, 'email' | 'first_name' | 'last_name'> & { password?: string },
		isSetup: boolean
	): Promise<typeof schema.users.$inferSelect> {
		if (!isSetup) {
			throw Error('This operation is only allowed upon initial setup.');
		}
		const { email, first_name, last_name, password } = userDetails;
		const userCountResult = await db
			.select({ count: sql<number>`count(*)` })
			.from(schema.users);
		const isFirstUser = Number(userCountResult[0].count) === 0;
		if (!isFirstUser) {
			throw Error('This operation is only allowed upon initial setup.');
		}
		const hashedPassword = password ? await hash(password, 10) : undefined;

		const newUser = await db
			.insert(schema.users)
			.values({
				email,
				first_name,
				last_name,
				password: hashedPassword,
			})
			.returning();

		// find super admin role
		let superAdminRole = await db.query.roles.findFirst({
			where: eq(schema.roles.name, 'Super Admin'),
		});

		if (!superAdminRole) {
			const suerAdminPolicies: PolicyStatement[] = [
				{
					Effect: 'Allow',
					Action: ['*'],
					Resource: ['*'],
				},
			];
			superAdminRole = (
				await db
					.insert(schema.roles)
					.values({
						name: 'Super Admin',
						policies: suerAdminPolicies,
					})
					.returning()
			)[0];
		}

		await db.insert(schema.userRoles).values({
			userId: newUser[0].id,
			roleId: superAdminRole.id,
		});

		return newUser[0];
	}
}
