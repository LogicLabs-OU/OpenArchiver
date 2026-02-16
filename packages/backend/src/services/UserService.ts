import { db } from '../database';
import * as schema from '../database/schema';
import { eq, sql } from 'drizzle-orm';
import { hash, compare } from 'bcryptjs';
import type { CaslPolicy, User } from '@open-archiver/types';
import { AuditService } from './AuditService';

export class UserService {
	private static auditService = new AuditService();
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
						role: true,
					},
				},
			},
		});
		if (!user) return null;

		return {
			...user,
			role: user.userRoles[0]?.role || null,
		};
	}

	public async findAll(): Promise<User[]> {
		const users = await db.query.users.findMany({
			with: {
				userRoles: {
					with: {
						role: true,
					},
				},
			},
		});

		return users.map((u) => ({
			...u,
			role: u.userRoles[0]?.role || null,
		}));
	}

	public async createUser(
		userDetails: Pick<User, 'email' | 'first_name' | 'last_name'> & { password?: string },
		roleId: string,
		actor: User,
		actorIp: string
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

		await UserService.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'CREATE',
			targetType: 'User',
			targetId: newUser[0].id,
			actorIp,
			details: {
				createdUserEmail: newUser[0].email,
			},
		});

		return newUser[0];
	}

	public async updateUser(
		id: string,
		userDetails: Partial<Pick<User, 'email' | 'first_name' | 'last_name'>>,
		roleId: string | undefined,
		actor: User,
		actorIp: string
	): Promise<typeof schema.users.$inferSelect | null> {
		const originalUser = await this.findById(id);
		const updatedUser = await db
			.update(schema.users)
			.set(userDetails)
			.where(eq(schema.users.id, id))
			.returning();

		if (roleId && originalUser?.role?.id !== roleId) {
			await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
			await db.insert(schema.userRoles).values({
				userId: id,
				roleId: roleId,
			});
			await UserService.auditService.createAuditLog({
				actorIdentifier: actor.id,
				actionType: 'UPDATE',
				targetType: 'User',
				targetId: id,
				actorIp,
				details: {
					field: 'role',
					oldValue: originalUser?.role?.name,
					newValue: roleId, // TODO: get role name
				},
			});
		}

		// TODO: log other user detail changes

		return updatedUser[0] || null;
	}

	public async deleteUser(id: string, actor: User, actorIp: string): Promise<void> {
		const userToDelete = await this.findById(id);
		await db.delete(schema.users).where(eq(schema.users.id, id));
		await UserService.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'DELETE',
			targetType: 'User',
			targetId: id,
			actorIp,
			details: {
				deletedUserEmail: userToDelete?.email,
			},
		});
	}

	public async updatePassword(
		id: string,
		currentPassword: string,
		newPassword: string,
		actor: User,
		actorIp: string
	): Promise<void> {
		const user = await db.query.users.findFirst({
			where: eq(schema.users.id, id),
		});

		if (!user || !user.password) {
			throw new Error('User not found');
		}

		const isPasswordValid = await compare(currentPassword, user.password);

		if (!isPasswordValid) {
			throw new Error('Invalid current password');
		}

		const hashedPassword = await hash(newPassword, 10);

		await db
			.update(schema.users)
			.set({ password: hashedPassword })
			.where(eq(schema.users.id, id));

		await UserService.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'UPDATE',
			targetType: 'User',
			targetId: id,
			actorIp,
			details: {
				field: 'password',
			},
		});
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

		const superAdminRole = await this.createAdminRole();

		await db.insert(schema.userRoles).values({
			userId: newUser[0].id,
			roleId: superAdminRole.id,
		});

		await UserService.auditService.createAuditLog({
			actorIdentifier: 'SYSTEM',
			actionType: 'SETUP',
			targetType: 'User',
			targetId: newUser[0].id,
			actorIp: '::1', // System action
			details: {
				setupAdminEmail: newUser[0].email,
			},
		});

		return newUser[0];
	}

	public async createAdminRole() {
		// find super admin role
		let superAdminRole = await db.query.roles.findFirst({
			where: eq(schema.roles.name, 'Super Admin'),
		});

		if (!superAdminRole) {
			const suerAdminPolicies: CaslPolicy[] = [
				{
					action: 'manage',
					subject: 'all',
				},
			];
			superAdminRole = (
				await db
					.insert(schema.roles)
					.values({
						name: 'Super Admin',
						slug: 'predefined_super_admin',
						policies: suerAdminPolicies,
					})
					.returning()
			)[0];
		}
		return superAdminRole;
	}
}
