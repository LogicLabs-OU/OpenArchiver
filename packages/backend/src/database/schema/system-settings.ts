import { pgTable, serial, jsonb } from 'drizzle-orm/pg-core';
import type { SystemSettings } from '@open-archiver/types';

export const systemSettings = pgTable('system_settings', {
    id: serial('id').primaryKey(),
    config: jsonb('config').$type<SystemSettings>().notNull(),
});
