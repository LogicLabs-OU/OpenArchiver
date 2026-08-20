import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type {
	ICleanupDuplicatesDispatch,
	ICleanupDuplicatesResult,
	IDuplicateCountResponse,
	User,
} from '@open-archiver/types';
import { db } from '../database';
import {
	archivedEmails,
	emailLegalHolds,
	emailRetentionLabels,
	legalHolds,
	retentionLabels,
} from '../database/schema';
import { ArchivedEmailService } from './ArchivedEmailService';
import { indexingQueue } from '../jobs/queues';
import { claimJobId } from '../jobs/helpers/claimJobId';
import { isIndexingWorkerAlive } from '../jobs/helpers/workerLiveness';
import { logger } from '../config/logger';

/** The one job id a duplicate sweep ever runs under, whatever its scope, so two cannot overlap. */
const CLEANUP_JOB_ID = 'cleanup-duplicates';

/** Surplus rows fetched per page. Each carries two ids and two hashes, so a page stays small. */
const PAGE_SIZE = 500;

/**
 * Repairs the archive against itself.
 *
 * Before the sync-overlap fix, two cycles could run over one mailbox at the same time. The dedup in
 * `processEmail` reads before it inserts and nothing made those two steps atomic, so both cycles
 * found nothing and both archived the same message. Sources covering the same mailbox therefore
 * ended up reporting different email counts while every one of them reported a successful sync.
 *
 * The overlap itself is fixed. This removes the copies that fix arrives too late for, and it is
 * deliberately a user-triggered action rather than part of a migration: an upgrade must never
 * remove data the operator did not agree to lose.
 */
export class ArchiveMaintenanceService {
	/**
	 * Surplus rows, numbered within their group so the survivor can be told from the copies.
	 *
	 * The group is `(source, mailbox, Message-ID)` — the same triple the dedup in IngestionService
	 * compares, mailbox included and reduced through the same `lower(btrim(...))`. Grouping on the
	 * raw column instead would miss a mailbox the provider re-cased between syncs, which is exactly
	 * the pair the dedup treats as one mailbox and this sweep therefore has to treat as one too.
	 *
	 * `rank = 1` is the row that stays. The ordering puts a row under legal hold first, so a hold is
	 * never dropped, and otherwise keeps the earliest. The survivor's hash rides along on every row,
	 * so a copy whose content differs from it can be refused without a second query.
	 *
	 * Merge groups need nothing extra here: a child source writes its rows under its root's id (the
	 * `effectiveSource` rule), so they already sit inside one source's partition.
	 */
	/**
	 * Whether a row carries a compliance obligation that forbids removing it.
	 *
	 * Decided here, in SQL, rather than left to `RetentionHook` — which is where every other
	 * deletion path checks it. The hook is a per-process registry populated by enterprise modules
	 * inside `createServer()`, and this sweep runs in the indexing worker, a process that never
	 * calls `createServer`. Its registry is empty in every deployment, OSS and enterprise alike, so
	 * `canDelete()` there answers yes to everything. Trusting it would have let a held email be
	 * deleted, and `email_legal_holds` cascades on the email, so the hold record would have gone
	 * with it and left no trace.
	 *
	 * The join tables are the authority, not `archived_emails.is_on_legal_hold`: no code in this
	 * package writes that column, so a genuinely held email can carry `false` there. The flag is
	 * still honoured as a second signal for deployments that do set it.
	 *
	 * `is_journaled` is nullable, hence `is true` rather than `= true`.
	 */
	static readonly #protectedRow = sql<boolean>`(
		${archivedEmails.isOnLegalHold} is true
		or ${archivedEmails.isJournaled} is true
		or exists (
			select 1 from ${emailLegalHolds}
			join ${legalHolds} on ${legalHolds.id} = ${emailLegalHolds.legalHoldId}
			where ${emailLegalHolds.emailId} = ${archivedEmails.id} and ${legalHolds.isActive}
		)
		or exists (
			select 1 from ${emailRetentionLabels}
			join ${retentionLabels} on ${retentionLabels.id} = ${emailRetentionLabels.labelId}
			where ${emailRetentionLabels.emailId} = ${archivedEmails.id}
				and ${retentionLabels.isDisabled} = false
		)
	)`;

	/**
	 * Surplus rows, numbered within their group so the survivor can be told from the copies.
	 *
	 * The group is `(source, mailbox, Message-ID)` — the same triple the dedup in IngestionService
	 * compares, mailbox included and reduced through the same `lower(btrim(...))`. Grouping on the
	 * raw column instead would miss a mailbox the provider re-cased between syncs, which is exactly
	 * the pair the dedup treats as one mailbox and this sweep therefore has to treat as one too.
	 *
	 * `rank = 1` is the row that stays. A protected row sorts first, so if the group is ever allowed
	 * to be touched the protected copy is the one kept; otherwise the earliest is. `isProtected` is
	 * the group's verdict rather than the row's — see the column. The survivor's hash rides along on
	 * every row, so a copy whose content differs from it can be refused without a second query.
	 *
	 * Merge groups need nothing extra here: a child source writes its rows under its root's id (the
	 * `effectiveSource` rule), so they already sit inside one source's partition.
	 */
	static #rankedDuplicates(ingestionSourceId?: string) {
		const mailbox = sql`lower(btrim(${archivedEmails.userEmail}))`;
		const partition = sql`partition by ${archivedEmails.ingestionSourceId}, ${mailbox}, ${archivedEmails.messageIdHeader}`;
		const order = sql`order by ${this.#protectedRow} desc, ${archivedEmails.archivedAt} asc, ${archivedEmails.id} asc`;

		return db
			.select({
				id: archivedEmails.id,
				hash: archivedEmails.storageHashSha256,
				// Group-level, not row-level. A hold is placed on a message, and both rows are
				// that message; removing either one changes the archive for a message someone is
				// obliged to preserve unchanged. So one protected copy freezes the whole group
				// rather than merely electing itself the survivor.
				isProtected: sql<boolean>`bool_or(${this.#protectedRow}) over (${partition})`.as(
					'is_protected'
				),
				rank: sql<number>`row_number() over (${partition} ${order})`.as('rank'),
				keptHash:
					sql<string>`first_value(${archivedEmails.storageHashSha256}) over (${partition} ${order})`.as(
						'kept_hash'
					),
				groupKey:
					sql<string>`${archivedEmails.ingestionSourceId} || ':' || ${mailbox} || ':' || ${archivedEmails.messageIdHeader}`.as(
						'group_key'
					),
			})
			.from(archivedEmails)
			.where(
				ingestionSourceId
					? and(
							isNotNull(archivedEmails.messageIdHeader),
							eq(archivedEmails.ingestionSourceId, ingestionSourceId)
						)
					: isNotNull(archivedEmails.messageIdHeader)
			)
			.as('ranked');
	}

	/**
	 * How many surplus rows a sweep would remove, and how many it would refuse on policy grounds.
	 *
	 * `duplicates` excludes protected copies, so the confirmation never quotes a figure that policy
	 * will then decline to act on. It remains an upper bound for one reason only: a copy whose
	 * content differs from the row being kept is detected during the sweep, not here.
	 */
	public static async countDuplicates(
		ingestionSourceId?: string
	): Promise<IDuplicateCountResponse> {
		const ranked = this.#rankedDuplicates(ingestionSourceId);
		const [row] = await db
			.select({
				duplicates: sql<number>`count(*) filter (where not ${ranked.isProtected})::int`,
				groups: sql<number>`count(distinct ${ranked.groupKey}) filter (where not ${ranked.isProtected})::int`,
				protected: sql<number>`count(*) filter (where ${ranked.isProtected})::int`,
			})
			.from(ranked)
			.where(sql`${ranked.rank} > 1`);

		return {
			duplicates: row?.duplicates ?? 0,
			groups: row?.groups ?? 0,
			protected: row?.protected ?? 0,
		};
	}

	/**
	 * Queues a sweep and reports what could be established without running it.
	 *
	 * One job id covers both scopes, so a per-source request joins a global sweep and the other way
	 * round. Two sweeps over overlapping rows would only race each other's deletes.
	 *
	 * `attempts: 1` for the reason the other destructive jobs use it: a retry after a partial run
	 * should be the operator's decision. Re-running is safe, and each pass finds strictly fewer.
	 */
	public static async triggerCleanupDuplicates(
		actor: User,
		actorIp: string,
		ingestionSourceId?: string
	): Promise<ICleanupDuplicatesDispatch> {
		const [{ duplicates }, workerAlive] = await Promise.all([
			this.countDuplicates(ingestionSourceId),
			isIndexingWorkerAlive(),
		]);

		const alreadyRunning = await claimJobId(indexingQueue, CLEANUP_JOB_ID);

		if (!alreadyRunning) {
			await indexingQueue.add(
				'cleanup-duplicates',
				{ ingestionSourceId, actorId: actor.id, actorIp },
				{ jobId: CLEANUP_JOB_ID, attempts: 1 }
			);
		}

		return { duplicatesFound: duplicates, workerAlive, alreadyRunning };
	}

	/**
	 * Removes the surplus copies, one message at a time.
	 *
	 * Deletion goes through `ArchivedEmailService.deleteArchivedEmail` rather than a delete of its
	 * own, because that method already gets right the parts that are easy to get wrong: it refuses a
	 * row under legal hold, it reference-counts the stored `.eml` and the attachment blobs so a file
	 * the surviving row still points at is left alone — duplicates always share that file, since its
	 * name derives from the Message-ID — and it waits for the Meilisearch document to be removed
	 * before the row goes, so this cleanup cannot leave behind the orphans of #446.
	 *
	 * The walk is a keyset on `id`, not an offset, and that is what makes it stable while it
	 * deletes: rows only ever disappear from behind the cursor, and removing a copy cannot change
	 * the rank of anything ahead of it — the survivor stays rank 1 and the other copies stay above
	 * it. Every surplus row is therefore visited exactly once, which an offset walk or a re-read
	 * from the start would not manage: the first would step over rows as the set shrank, the second
	 * would re-count every skipped row on every page.
	 */
	public static async cleanupDuplicates(
		actor: User,
		actorIp: string,
		ingestionSourceId?: string
	): Promise<ICleanupDuplicatesResult> {
		let examined = 0;
		let removed = 0;
		let skippedProtected = 0;
		let skippedContentDiffers = 0;
		let skippedFailed = 0;
		let cursor: string | null = null;

		for (;;) {
			const ranked = this.#rankedDuplicates(ingestionSourceId);
			const page = await db
				.select({
					id: ranked.id,
					hash: ranked.hash,
					keptHash: ranked.keptHash,
					isProtected: ranked.isProtected,
				})
				.from(ranked)
				.where(
					cursor
						? sql`${ranked.rank} > 1 and ${ranked.id} > ${cursor}`
						: sql`${ranked.rank} > 1`
				)
				.orderBy(ranked.id)
				.limit(PAGE_SIZE);

			if (page.length === 0) {
				break;
			}

			cursor = page[page.length - 1].id;

			for (const row of page) {
				examined++;

				// Refused before any deletion is attempted, so the guarantee holds whether or not a
				// retention check happens to be registered in this process — in the worker, none is.
				// The flag covers the whole group, so one held, labelled or journaled copy leaves
				// every copy of that message exactly where it is.
				if (row.isProtected) {
					skippedProtected++;
					continue;
				}

				// The rule that makes this safe to offer at all. Two rows can share a Message-ID
				// without being the same email — an id reused by a sender, a draft later sent under
				// it — and collapsing those would lose a message rather than a duplicate.
				if (row.hash !== row.keptHash) {
					skippedContentDiffers++;
					continue;
				}

				try {
					await ArchivedEmailService.deleteArchivedEmail(row.id, actor, actorIp);
					removed++;
				} catch (error) {
					// Counted apart from the policy refusals above, which are decided before the
					// attempt: anything reaching here is a genuine failure. One unremovable row must
					// not abandon the rest of the archive's duplicates.
					skippedFailed++;
					logger.warn(
						{ err: error, emailId: row.id, ingestionSourceId },
						'Failed to remove a duplicate copy - left in place'
					);
				}
			}

			logger.info(
				{
					examined,
					removed,
					skippedProtected,
					skippedContentDiffers,
					skippedFailed,
					ingestionSourceId,
				},
				'Duplicate cleanup progress'
			);
		}

		return { examined, removed, skippedProtected, skippedContentDiffers, skippedFailed };
	}
}
