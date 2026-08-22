import { sql, asc, eq } from 'drizzle-orm';
import type { SystemSettings } from '@open-archiver/types';
import { db } from './index';
import { systemSettings } from './schema';

const DEFAULT_SETTINGS: SystemSettings = {
	language: 'en',
	theme: 'system',
	supportEmail: null,
};

/**
 * Ensures the singleton `system_settings` row exists and returns it.
 *
 * The insert only fires when the table is completely empty, so an existing row
 * whose id is not 1 is never duplicated. `ON CONFLICT (id) DO NOTHING` keeps
 * concurrent fresh-database startups race-safe: if two nodes both pass the
 * `NOT EXISTS` check, the loser's insert becomes a no-op instead of raising a
 * unique-key violation.
 *
 * The row is read back ordered by `id` so every caller converges on the same
 * (lowest-id) row regardless of insertion history.
 */
export async function ensureSystemSettingsRow(): Promise<{ id: number; config: SystemSettings }> {
	await db.execute(sql`
		INSERT INTO system_settings (id, config)
		SELECT 1, ${JSON.stringify(DEFAULT_SETTINGS)}::jsonb
		WHERE NOT EXISTS (SELECT 1 FROM system_settings)
		ON CONFLICT (id) DO NOTHING
	`);

	const [row] = await db.select().from(systemSettings).orderBy(asc(systemSettings.id)).limit(1);

	return row;
}

/**
 * Merges a partial config into the singleton `system_settings` row and returns
 * the result.
 *
 * The merge happens in SQL via the JSONB `||` operator rather than by spreading
 * in JS. A read-modify-write of the whole object would silently discard keys
 * written by a concurrent writer between the read and the write — the row is
 * shared by user settings, the security policy, the deployment's instanceId and
 * the license status, so that loss is not theoretical.
 *
 * `||` is a shallow top-level merge, matching the previous spread semantics.
 * Note that `JSON.stringify` omits `undefined` values: clear a field with `null`.
 *
 * Callers are responsible for restricting which keys they pass — in particular
 * anything reachable from a request body must be allowlisted first.
 */
export async function mergeSystemSettingsConfig(
	partial: Record<string, unknown>
): Promise<SystemSettings> {
	const row = await ensureSystemSettingsRow();

	const [updated] = await db
		.update(systemSettings)
		.set({
			config: sql`${systemSettings.config} || ${JSON.stringify(partial)}::jsonb`,
		})
		.where(eq(systemSettings.id, row.id))
		.returning();

	return updated.config;
}
