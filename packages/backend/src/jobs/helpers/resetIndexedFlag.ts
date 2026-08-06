import { and, asc, gt, inArray, type SQL } from 'drizzle-orm';
import { db } from '../../database';
import { archivedEmails } from '../../database/schema';

/** Keyset page size for the reset scan. Bounds each UPDATE so no single statement
 *  locks the whole table on a full-archive reindex. */
const RESET_BATCH_SIZE = 5000;

interface ResetOptions {
	/** Scope filter (e.g. an ingestion-source group). Undefined = every archived email. */
	where?: SQL;
	/** Values to set on each matched row. */
	set: Partial<typeof archivedEmails.$inferInsert>;
}

/**
 * Applies `set` to `archived_emails` rows matching `where`, in id-ordered keyset batches
 * (select a page of ids, then UPDATE ... WHERE id IN page) instead of one table-wide
 * UPDATE. Used by the reindex processor so a full rebuild does not take a giant, long-held
 * lock at millions-of-rows scale.
 *
 * @returns the number of rows updated.
 */
export async function resetIndexedFlagChunked(options: ResetOptions): Promise<number> {
	const { where, set } = options;

	let cursor: string | null = null;
	let totalUpdated = 0;

	while (true) {
		const conditions: SQL[] = [];
		if (where) {
			conditions.push(where);
		}
		if (cursor) {
			conditions.push(gt(archivedEmails.id, cursor));
		}

		const rows = await db
			.select({ id: archivedEmails.id })
			.from(archivedEmails)
			.where(conditions.length ? and(...conditions) : undefined)
			.orderBy(asc(archivedEmails.id))
			.limit(RESET_BATCH_SIZE);

		if (rows.length === 0) {
			break;
		}

		const ids = rows.map((r) => r.id);
		await db.update(archivedEmails).set(set).where(inArray(archivedEmails.id, ids));

		totalUpdated += ids.length;
		cursor = ids[ids.length - 1];

		if (rows.length < RESET_BATCH_SIZE) {
			break;
		}
	}

	return totalUpdated;
}
