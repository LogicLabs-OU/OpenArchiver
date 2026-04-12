import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import 'dotenv/config';

import * as schema from './schema';
import { getDatabaseConfig } from '../helpers/db';

const databaseConfig = getDatabaseConfig();
const client =
	typeof databaseConfig === 'string' ? postgres(databaseConfig) : postgres(databaseConfig);
export const db = drizzle(client, { schema });
export type Database = PostgresJsDatabase<typeof schema>;
