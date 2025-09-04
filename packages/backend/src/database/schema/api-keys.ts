import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const apiKeys = pgTable('api_keys', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // Encrypted API key
    keyHash: text('key_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
