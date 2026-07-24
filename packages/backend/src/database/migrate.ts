import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from 'dotenv';
import { getDatabaseConfig } from '../helpers/db';

config();

const runMigrate = async () => {
	const databaseConfig = getDatabaseConfig();
	const connection =
		typeof databaseConfig === 'string'
			? postgres(databaseConfig, { max: 1 })
			: postgres({ ...databaseConfig, max: 1 });
	const db = drizzle(connection);

	console.log('Running migrations...');

	await migrate(db, { migrationsFolder: 'src/database/migrations' });

	console.log('Migrations completed!');
	process.exit(0);
};

runMigrate().catch((err) => {
	console.error('Migration failed!', err);
	process.exit(1);
});
