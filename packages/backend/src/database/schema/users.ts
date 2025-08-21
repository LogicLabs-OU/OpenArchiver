import { relations, sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid, primaryKey, jsonb } from 'drizzle-orm/pg-core';
import type { CaslPolicy } from '@open-archiver/types';

/**
 * The `users` table stores the core user information for authentication and identification.
 */
export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	email: text('email').notNull().unique(),
	first_name: text('first_name'),
	last_name: text('last_name'),
	password: text('password'),
	provider: text('provider').default('local'),
	providerId: text('provider_id'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * The `sessions` table stores user session information for managing login state.
 * It links a session to a user and records its expiration time.
 */
export const sessions = pgTable('sessions', {
	id: text('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', {
		withTimezone: true,
		mode: 'date',
	}).notNull(),
});

/**
 * The `roles` table defines the roles that can be assigned to users.
 * Each role has a name and a set of policies that define its permissions.
 */
export const roles = pgTable('roles', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull().unique(),
	policies: jsonb('policies')
		.$type<CaslPolicy[]>()
		.notNull()
		.default(sql`'[]'::jsonb`),
	slug: text('slug').unique(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * The `user_roles` table is a join table that maps users to their assigned roles.
 * This many-to-many relationship allows a user to have multiple roles.
 */
export const userRoles = pgTable(
	'user_roles',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		roleId: uuid('role_id')
			.notNull()
			.references(() => roles.id, { onDelete: 'cascade' }),
	},
	(t) => [primaryKey({ columns: [t.userId, t.roleId] })]
);

// Define relationships for Drizzle ORM
export const usersRelations = relations(users, ({ many }) => ({
	userRoles: many(userRoles),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
	userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
	role: one(roles, {
		fields: [userRoles.roleId],
		references: [roles.id],
	}),
	user: one(users, {
		fields: [userRoles.userId],
		references: [users.id],
	}),
}));
