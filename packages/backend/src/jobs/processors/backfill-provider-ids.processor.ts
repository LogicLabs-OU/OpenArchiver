import { Job } from 'bullmq';
import { and, asc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../../database';
import { archivedEmails, ingestionSources } from '../../database/schema';
import { IngestionService, matchesMailbox } from '../../services/IngestionService';
import { EmailProviderFactory } from '../../services/EmailProviderFactory';
import { MicrosoftConnector } from '../../services/ingestion-connectors/MicrosoftConnector';
import { normalizeEmailAddress } from '../../helpers/emailAddress';
import { logger } from '../../config/logger';

/** translateExchangeIds accepts at most 1000 ids per call. */
const BATCH_SIZE = 1000;

interface IBackfillProviderIdsJob {
	ingestionSourceId: string;
}

/**
 * One-shot conversion of stored regular Graph message ids to their immutable form, per source.
 *
 * Ships alongside the switch to `Prefer: IdType="ImmutableId"`: from that release on, Graph hands
 * out immutable ids while every previously archived row still stores the regular one, so the
 * pre-download dedup check would miss all of them and fall back to matching by Message-ID. That
 * fallback keeps dedup correct — this job exists so the provider-id fast path recovers too, and
 * with it the "source of truth" property of the column.
 *
 * Idempotent by construction rather than cursor-tracked: an id that is already immutable, or whose
 * message no longer exists, simply comes back untranslated and its row is left alone. A crashed
 * run can be re-run from the start without harm, so completion is recorded as a single timestamp
 * in the source's syncState (written with a jsonb merge so a concurrent sync writing delta tokens
 * can never be clobbered by it — the reverse race only costs a harmless re-run).
 *
 * Rows whose provider_message_id is NULL are out of reach by nature (nothing to translate) and are
 * intentionally not touched: they dedupe by Message-ID, and the pre-check's opportunistic refresh
 * fills them in as they are re-encountered.
 */
export default async function backfillProviderIdsProcessor(
	job: Job<IBackfillProviderIdsJob>
): Promise<void> {
	const { ingestionSourceId } = job.data;

	const source = await IngestionService.findById(ingestionSourceId);
	if (source.provider !== 'microsoft_365') {
		return;
	}
	if (source.syncState?.providerIdBackfillCompletedAt) {
		return;
	}

	const connector = EmailProviderFactory.createConnector(source);
	if (!(connector instanceof MicrosoftConnector)) {
		return;
	}

	const groupIds = await IngestionService.findGroupSourceIds(ingestionSourceId);
	const sourceFilter =
		groupIds.length === 1
			? eq(archivedEmails.ingestionSourceId, groupIds[0])
			: inArray(archivedEmails.ingestionSourceId, groupIds);

	let translated = 0;
	let unresolved = 0;
	let skippedForeign = 0;

	logger.info({ ingestionSourceId }, 'Starting provider-id backfill');

	for await (const user of connector.listAllUsers()) {
		if (!user.primaryEmail) {
			continue;
		}
		const userEmail = normalizeEmailAddress(user.primaryEmail);

		// Keyset pagination over this mailbox's rows. The batch is re-read from the top after
		// updates would be wrong (updated rows still match the filter), so the cursor is the
		// row id — updates never move a row past it.
		let cursor: string | null = null;
		for (;;) {
			const rows: { id: string; providerMessageId: string | null }[] =
				await db.query.archivedEmails.findMany({
					where: and(
						sourceFilter,
						matchesMailbox(userEmail),
						isNotNull(archivedEmails.providerMessageId),
						cursor ? gt(archivedEmails.id, cursor) : undefined
					),
					columns: { id: true, providerMessageId: true },
					orderBy: asc(archivedEmails.id),
					limit: BATCH_SIZE,
				});
			if (rows.length === 0) {
				break;
			}
			cursor = rows[rows.length - 1].id;

			// A merge group can mix connectors, and merged children write their rows under the
			// root source id — so this mailbox's rows may include IMAP-style ids, which are RFC
			// Message-IDs. Graph cannot translate those and they are not stale; sending them
			// would only waste batch slots.
			const candidates = rows.filter(
				(row): row is { id: string; providerMessageId: string } =>
					typeof row.providerMessageId === 'string' &&
					!row.providerMessageId.includes('@') &&
					!row.providerMessageId.includes('<')
			);
			skippedForeign += rows.length - candidates.length;
			if (candidates.length === 0) {
				continue;
			}

			const map = await connector.translateIds(
				userEmail,
				candidates.map((row) => row.providerMessageId)
			);

			for (const row of candidates) {
				const immutableId = map.get(row.providerMessageId);
				if (!immutableId) {
					// Already immutable, or the message is gone. Either way the row is not
					// wrong enough to touch: the Message-ID branch of the dedup check covers
					// it, and the pre-check refresh converges it if it is ever seen again.
					unresolved++;
					continue;
				}
				await db
					.update(archivedEmails)
					.set({ providerMessageId: IngestionService.boundMessageKey(immutableId) })
					.where(eq(archivedEmails.id, row.id));
				translated++;
			}
		}
	}

	// jsonb merge, NOT read-modify-write: a sync cycle finishing concurrently writes the whole
	// syncState object with fresh delta tokens, and replaying a stale copy from here would
	// destroy them — which forces the very full re-listing this feature exists to make cheap.
	// The merge can still lose to such a write (flag dropped), and that is the acceptable
	// direction: the job just runs again next cycle and finds nothing left to translate.
	await db
		.update(ingestionSources)
		.set({
			syncState: sql`coalesce(${ingestionSources.syncState}, '{}'::jsonb) || jsonb_build_object('providerIdBackfillCompletedAt', ${new Date().toISOString()}::text)`,
		})
		.where(eq(ingestionSources.id, ingestionSourceId));

	logger.info(
		{ ingestionSourceId, translated, unresolved, skippedForeign },
		'Provider-id backfill finished'
	);
}
