import { db } from '../database';
import * as schema from '../database/schema';
import { eq, sql } from 'drizzle-orm';
import { hash, compare } from 'bcryptjs';
import type { CaslPolicy, User } from '@open-archiver/types';
import { AuditService } from './AuditService';
import { IdentityPolicyHook } from '../hooks/IdentityPolicyHook';
import { normalizeEmailAddress } from '../helpers/emailAddress';

/**
 * The verdict on a submitted email address.
 *
 * `unchanged` is separate from `allowed` on purpose: the profile form posts every
 * field on every save, so a federated account saving a new first name submits its
 * own address untouched. Treating that as a change would refuse the save, and
 * writing it back would rewrite the stored casing for nothing.
 */
export type EmailChangeDecision =
	| { outcome: 'unchanged' }
	| { outcome: 'allowed'; email: string }
	| { outcome: 'denied'; reason: string; status: 403 | 409 };

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
	/**
	 * The columns that make up the public `User` shape.
	 *
	 * Spreading the whole row here would put `password`, `totpSecret` and `totpBackupCodes` on
	 * every object these methods return — including the ones serialized straight back to the
	 * client by `GET /users` and `GET /users/:id`. Credential material is read through
	 * `findByEmail`, which deliberately returns the raw row.
	 */
	static readonly #publicColumns = {
		id: true,
		email: true,
		first_name: true,
		last_name: true,
		createdAt: true,
		totpEnabled: true,
		provider: true,
	} as const;

	public async findById(id: string): Promise<User | null> {
		const user = await db.query.users.findFirst({
			where: eq(schema.users.id, id),
			// `password` is selected only to be collapsed into a boolean below.
			// It is destructured out explicitly — never spread — so the hash
			// cannot reach a response shape the way the raw login row once did.
			columns: { ...UserService.#publicColumns, password: true },
			with: {
				userRoles: {
					with: {
						role: true,
					},
				},
			},
		});
		if (!user) return null;

		const { password, userRoles, ...publicFields } = user;
		return {
			...publicFields,
			hasPassword: Boolean(password),
			role: userRoles[0]?.role || null,
		};
	}

	public async findAll(): Promise<User[]> {
		const users = await db.query.users.findMany({
			// Same arrangement as findById: the hash is read, collapsed, discarded.
			columns: { ...UserService.#publicColumns, password: true },
			with: {
				userRoles: {
					with: {
						role: true,
					},
				},
			},
		});

		return users.map((u) => {
			const { password, userRoles, ...publicFields } = u;
			return {
				...publicFields,
				hasPassword: Boolean(password),
				role: userRoles[0]?.role || null,
			};
		});
	}

	public async createUser(
		userDetails: Pick<User, 'email' | 'first_name' | 'last_name'> & { password?: string },
		roleId: string,
		actor: User,
		actorIp: string
	): Promise<User | null> {
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

		// The public projection, for the same reason as `updateUser`: the controller
		// serializes this to the browser, and the inserted row carries the password
		// hash that was just written.
		return this.findById(newUser[0].id);
	}

	/**
	 * Whether this account may take the submitted address.
	 *
	 * Both write paths ask before writing, because the address is what every other
	 * identity decision keys on: SSO links an assertion to whichever local account
	 * already holds the asserted address, and the "require single sign-on" policy
	 * decides who it covers from the stored domain. An account free to rewrite its
	 * own address is therefore free to claim someone else's identity and to leave
	 * the enforcement policy's reach.
	 *
	 * @param selfService False when an administrator is acting on someone else, which
	 * relaxes the reserved-domain rule — preparing accounts ahead of a first sign-in
	 * is exactly how "Link to existing accounts" is meant to be used.
	 */
	public async assessEmailChange(
		target: User,
		newEmail: string | undefined | null,
		selfService: boolean
	): Promise<EmailChangeDecision> {
		if (typeof newEmail !== 'string' || newEmail.trim() === '') {
			return { outcome: 'unchanged' };
		}

		const next = normalizeEmailAddress(newEmail);
		if (next === normalizeEmailAddress(target.email)) {
			return { outcome: 'unchanged' };
		}

		if (!/^[^\s@]+@[^\s@]+$/.test(next)) {
			return { outcome: 'denied', reason: 'user.emailInvalid', status: 403 };
		}

		// A federated account's address belongs to the identity provider. Rewriting
		// it locally decides nothing — the next assertion carries the provider's
		// address regardless — while breaking the two rules above in the meantime.
		if (target.provider && target.provider !== 'local') {
			return { outcome: 'denied', reason: 'user.emailManagedByProvider', status: 403 };
		}

		if (selfService) {
			const reason = await IdentityPolicyHook.emailChangeDenialReason(
				{ id: target.id, email: target.email, provider: target.provider },
				next
			);
			if (reason) return { outcome: 'denied', reason, status: 403 };
		}

		// Checked here rather than left to the unique constraint: an unhandled
		// constraint violation reaches the browser as a 500, which reads as a broken
		// server instead of an address someone else already has.
		const [taken] = await db
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(sql`lower(${schema.users.email}) = ${next}`);
		if (taken && taken.id !== target.id) {
			return { outcome: 'denied', reason: 'user.emailAlreadyInUse', status: 409 };
		}

		return { outcome: 'allowed', email: next };
	}

	public async updateUser(
		id: string,
		userDetails: Partial<Pick<User, 'email' | 'first_name' | 'last_name'>>,
		roleId: string | undefined,
		actor: User,
		actorIp: string
	): Promise<User | null> {
		const originalUser = await this.findById(id);

		// Only the fields the caller actually sent. `set()` refuses an object whose
		// every value is undefined, which is what a request carrying nothing but a
		// role change now looks like — the address is dropped before it gets here
		// when the account may not change it.
		const fields = Object.fromEntries(
			Object.entries(userDetails).filter(([, value]) => value !== undefined)
		);
		if (Object.keys(fields).length > 0) {
			await db.update(schema.users).set(fields).where(eq(schema.users.id, id));
		}

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

		// One entry per changed field, in the same shape as the role entry above. An
		// address change matters most: it is what the SSO linking step and the login
		// policy read, so a change here has to leave a trail that names both values.
		for (const field of ['email', 'first_name', 'last_name'] as const) {
			const newValue = userDetails[field];
			if (newValue === undefined) continue;
			const oldValue = originalUser?.[field] ?? null;
			if (newValue === oldValue) continue;

			await UserService.auditService.createAuditLog({
				actorIdentifier: actor.id,
				actionType: 'UPDATE',
				targetType: 'User',
				targetId: id,
				actorIp,
				details: { field, oldValue, newValue },
			});
		}

		// Re-read through the public projection rather than returning what the write
		// produced: `returning()` hands back the whole row, and both callers send this
		// straight to the browser — which put the password hash, the TOTP secret and
		// the backup codes on the wire.
		return this.findById(id);
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
