/**
 * Vitest global setup. Populates the env vars that the production config
 * modules (`src/config/storage.ts`, `src/database/index.ts`, etc.) demand at
 * import time. Test code that needs different values can still override these
 * via `vi.stubEnv` inside the test body.
 *
 * These are stub values — the test harness must never reach a real DB,
 * Meilisearch, or S3.
 */
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE ?? 'local';
process.env.STORAGE_LOCAL_ROOT_PATH =
	process.env.STORAGE_LOCAL_ROOT_PATH ?? '/tmp/open-archiver-test-storage';
process.env.DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6379';
process.env.MEILI_HOST = process.env.MEILI_HOST ?? 'http://localhost:7700';
process.env.MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY ?? 'test-master-key';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '1h';
process.env.ENCRYPTION_KEY =
	process.env.ENCRYPTION_KEY ?? '00000000000000000000000000000000';
