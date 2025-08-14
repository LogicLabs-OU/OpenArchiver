import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from 'dotenv';
import { encodeDatabaseUrl } from '../helpers/db';

config();

const runMigrate = async () => {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not set in the .env file');
    }

    const connectionString = encodeDatabaseUrl(process.env.DATABASE_URL);
    const connection = postgres(connectionString, { max: 1 });
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
