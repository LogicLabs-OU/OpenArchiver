import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import 'dotenv/config';

import * as schema from './schema';
import { encodeDatabaseUrl } from '../helpers/db';

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set in the .env file');
}

const connectionString = encodeDatabaseUrl(process.env.DATABASE_URL);
const client = postgres(connectionString);
export const db = drizzle(client, { schema });
export type Database = PostgresJsDatabase<typeof schema>;
