import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { getDatabaseConfig } from 'src/helpers/db';

config();

export default defineConfig({
	schema: './src/database/schema.ts',
	out: './src/database/migrations',
	dialect: 'postgresql',
	dbCredentials: getDatabaseConfig(true),
	verbose: true,
	strict: true,
});
