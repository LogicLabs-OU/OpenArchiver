import { and, asc, count, eq, gt, inArray, type SQL } from 'drizzle-orm';
import { MeiliSearchApiError } from 'meilisearch';
import type {
	ICleanupOrphansDispatch,
	ICleanupOrphansResult,
	IVerifyIndexDispatch,
	IVerifyIndexResult,
	PendingEmail,
} from '@open-archiver/types';
import { db } from '../database';
import { archivedEmails } from '../database/schema';
import { SearchService } from './SearchService';
import { IngestionService } from './IngestionService';
import { quoteMeiliString } from '../helpers/meiliFilter';
import { indexingQueue } from '../jobs/queues';
import { isIndexingWorkerAlive } from '../jobs/helpers/workerLiveness';
import { claimJobId } from '../jobs/helpers/claimJobId';
import { config } from '../config';
import { logger } from '../config/logger';

/** Document ids read from the index per page. Ids only, so ~36 bytes each. */
const SCAN_PAGE_SIZE = 20_000;

/** Ids per delete request. Caps request size; the buffer itself is bounded by the page size. */
const DELETE_BATCH_SIZE = 5_000;

/** The one job id a sweep ever runs under, so two can never overlap. */
const CLEANUP_JOB_ID = 'cleanup-orphans';

/** The one job id a verification ever runs under, for the same reason. */
const VERIFY_JOB_ID = 'verify-index';

/** Rows checked per page of the verification walk: one Postgres read and one index lookup each. */
const VERIFY_PAGE_SIZE = 2_000;

/** Ids per reset statement, matching IndexingService.markIndexed. */
const RESET_CHUNK_SIZE = 1_000;

/** Ids per existence query, keeping the IN(...) list and its bind parameters bounded. */
const EXISTENCE_CHUNK_SIZE = 5_000;

/**
 * Repairs the search index against the database.
 *
 * The archive's source of truth is `archived_emails` plus the stored `.eml` files; the search index
 * is a derived copy. When a delete removes rows but its Meilisearch counterpart never lands — the
 * task was only enqueued and never confirmed, or the engine was down — the index keeps documents
 * for emails that no longer exist. Search then returns hits that cannot be opened, which is what
 * users see as "Email not found" (#446).
 *
 * Nothing here writes to the database or to storage. The only destructive action is removing index
 * documents whose email row is absent, and a document is only ever written for a row that exists,
 * so an absent row means the document outlived its email.
 */
export class IndexMaintenanceService {
	readonly #searchService: SearchService;

	constructor(searchService: SearchService = new SearchService()) {
		this.#searchService = searchService;
	}

	/**
	 * Queues a cleanup sweep and reports what could be established without running it.
	 *
	 * The exact orphan count needs the sweep itself, so the estimate is the surplus of documents
	 * over archived rows — the shape the problem takes from outside. Emails archived but not yet
	 * indexed count the other way and hide orphans one for one, so it is a floor, never a promise.
	 *
	 * A fixed `jobId` keeps two sweeps from running at once, since they would compete over the same
	 * shifting offsets. `attempts: 1` for the same reason the reindex master uses it: this deletes,
	 * so retrying is the operator's call.
	 */
	public static async triggerCleanupOrphans(): Promise<ICleanupOrphansDispatch> {
		const searchService = new SearchService();
		const [indexedCount, archived, workerAlive] = await Promise.all([
			searchService.getIndexedCount('emails').catch(() => 0),
			db.select({ total: count() }).from(archivedEmails),
			isIndexingWorkerAlive(),
		]);

		const archivedCount = archived[0]?.total ?? 0;
		const alreadyRunning = await claimJobId(indexingQueue, CLEANUP_JOB_ID);

		if (!alreadyRunning) {
			await indexingQueue.add('cleanup-orphans', {}, { jobId: CLEANUP_JOB_ID, attempts: 1 });
		}

		return {
			estimatedOrphans: Math.max(0, indexedCount - archivedCount),
			workerAlive,
			alreadyRunning,
		};
	}

	/**
	 * Queues a verification walk.
	 *
	 * Same single-instance rule as the orphan sweep: a fixed `jobId`, `attempts: 1`. Re-running is
	 * safe — a second pass only finds what the first did not already queue — so an interrupted
	 * verification is resumed by triggering it again.
	 */
	public static async triggerVerifyIndex(): Promise<IVerifyIndexDispatch> {
		const workerAlive = await isIndexingWorkerAlive();
		const alreadyRunning = await claimJobId(indexingQueue, VERIFY_JOB_ID);

		if (!alreadyRunning) {
			await indexingQueue.add('verify-index', {}, { jobId: VERIFY_JOB_ID, attempts: 1 });
		}

		return { workerAlive, alreadyRunning };
	}

	/**
	 * Finds emails marked indexed whose document the search index does not have, and queues them
	 * for indexing again.
	 *
	 * `is_indexed` is only set once Meilisearch confirms a write, but rows can still end up marked
	 * without a document: the upgrade to v0.5.1 marked every existing row indexed without asking the
	 * engine (migration 0037), and an index restored from an old dump or a lost data directory leaves
	 * the same state. Reconcile only looks at unmarked rows, so nothing else ever finds these.
	 *
	 * The walk reads a page of marked rows from the database first, then asks the index which of
	 * those ids it holds. That order keeps the answer exact while indexing carries on: a row read as
	 * marked had its write confirmed before the read, so an id the lookup does not return is absent
	 * rather than not yet visible. Memory is one page of ids, whatever the size of the archive.
	 *
	 * Missing rows are reset and queued here, not left for reconcile: reconcile scans every unmarked
	 * row, and would pick up rows that in-flight jobs already own. The reset is needed even though the
	 * rows are queued straight after, because the indexer skips any id still marked indexed.
	 */
	public async verifyIndex(indexName = 'emails'): Promise<IVerifyIndexResult> {
		const batchSize = config.meili.indexingBatchSize;
		const resetBySource: Record<string, number> = {};
		let rowsChecked = 0;
		let rowsReset = 0;
		let enqueued = 0;
		let toEnqueue: PendingEmail[] = [];
		let cursor: string | null = null;

		const flush = async (all: boolean): Promise<void> => {
			while (toEnqueue.length >= batchSize || (all && toEnqueue.length > 0)) {
				const emails = toEnqueue.slice(0, batchSize);
				await indexingQueue.add('index-email-batch', { emails });
				toEnqueue = toEnqueue.slice(emails.length);
				enqueued += emails.length;
			}
		};

		for (;;) {
			const conditions: SQL[] = [eq(archivedEmails.isIndexed, true)];
			if (cursor) {
				conditions.push(gt(archivedEmails.id, cursor));
			}

			const rows = await db
				.select({ id: archivedEmails.id, sourceId: archivedEmails.ingestionSourceId })
				.from(archivedEmails)
				.where(and(...conditions))
				.orderBy(asc(archivedEmails.id))
				.limit(VERIFY_PAGE_SIZE);

			if (rows.length === 0) {
				break;
			}

			const existing = await this.#lookupExisting(
				indexName,
				rows.map((r) => r.id),
				rowsChecked === 0
			);
			const missing = rows.filter((r) => !existing.has(r.id));

			if (missing.length > 0) {
				const ids = missing.map((r) => r.id);
				for (let i = 0; i < ids.length; i += RESET_CHUNK_SIZE) {
					await db
						.update(archivedEmails)
						.set({ isIndexed: false, indexAttempts: 0 })
						.where(inArray(archivedEmails.id, ids.slice(i, i + RESET_CHUNK_SIZE)));
				}

				for (const row of missing) {
					resetBySource[row.sourceId] = (resetBySource[row.sourceId] ?? 0) + 1;
				}
				rowsReset += missing.length;
				toEnqueue.push(...ids.map((id) => ({ archivedEmailId: id })));
				await flush(false);

				logger.info(
					{ checked: rows.length, missing: missing.length },
					'Index verification reset emails missing from the search index'
				);
			}

			rowsChecked += rows.length;
			cursor = rows[rows.length - 1].id;

			if (rows.length < VERIFY_PAGE_SIZE) {
				break;
			}
		}

		await flush(true);

		return { rowsChecked, rowsReset, enqueued, resetBySource };
	}

	/**
	 * The index lookup for one page. On the first page only, a request the engine does not
	 * understand is reported as the version requirement it almost certainly is, so an operator on
	 * an old Meilisearch sees why the job failed instead of a bare "bad request".
	 */
	async #lookupExisting(indexName: string, ids: string[], firstPage: boolean) {
		try {
			return await this.#searchService.getExistingDocumentIds(indexName, ids);
		} catch (error) {
			if (
				firstPage &&
				error instanceof MeiliSearchApiError &&
				error.cause?.code === 'bad_request'
			) {
				throw new Error(
					`Index verification needs Meilisearch 1.14 or newer (document lookup by id): ${error.message}`
				);
			}
			throw error;
		}
	}

	/**
	 * Removes every document whose email is gone, in two passes.
	 *
	 * The first pass clears whole sources: deleting an ingestion source cascades its rows away in
	 * one statement, so its documents are orphaned as a block and `ingestionSourceId` — being
	 * filterable — deletes them without reading a single id. This is the common case and by far
	 * the cheaper one.
	 *
	 * The second pass sweeps what remains document by document, for emails deleted individually.
	 */
	public async cleanupOrphans(indexName = 'emails'): Promise<ICleanupOrphansResult> {
		const sourceBlocksRemoved = await this.#removeDeletedSourceBlocks(indexName);
		const { documentsRemoved, scanned } = await this.#sweepOrphanedDocuments(indexName);

		return { sourceBlocksRemoved, documentsRemoved, scanned };
	}

	/**
	 * Deletes the documents of ingestion sources the database no longer has.
	 *
	 * The per-source counts already come from a facet distribution over the index itself, so a
	 * source appearing there without a matching row is precisely a block of orphans.
	 */
	async #removeDeletedSourceBlocks(indexName: string): Promise<number> {
		const overview = await this.#searchService.getInstanceOverview();
		const deletedSources = overview.documentsBySource.filter((s) => s.name === null);

		if (deletedSources.length === 0) {
			return 0;
		}

		// Re-confirmed against the database before anything is deleted. The names in the overview
		// come from a lookup that degrades to an empty map on error, and an empty map reads as
		// "every source was deleted" — so trusting it would empty the whole index the first time a
		// query failed. This re-check is deliberately not caught: if the database cannot answer,
		// the job fails having deleted nothing, rather than taking silence for permission.
		const names = await IngestionService.getSourceNames(
			deletedSources.map((s) => s.ingestionSourceId)
		);
		const confirmedDeleted = deletedSources.filter((s) => !(s.ingestionSourceId in names));

		let removed = 0;
		for (const source of confirmedDeleted) {
			const task = await this.#searchService.deleteDocumentsByFilter(
				indexName,
				`ingestionSourceId = ${quoteMeiliString(source.ingestionSourceId)}`
			);
			// Waited, not fire-and-forget: an unconfirmed delete is how these orphans were created.
			await this.#searchService.waitForTask(task.taskUid);

			removed += source.count;
			logger.info(
				{ ingestionSourceId: source.ingestionSourceId, documents: source.count },
				'Removed index documents for a deleted ingestion source'
			);
		}

		return removed;
	}

	/**
	 * Walks the index and deletes documents whose email row is absent.
	 *
	 * Pagination is by offset because this client offers no document cursor, which means every
	 * delete shifts the documents behind it into positions the walk has already passed. The offset
	 * is therefore advanced by the page size minus what the page's delete removed, so the next read
	 * resumes where the walk actually left off rather than skipping that many documents.
	 */
	async #sweepOrphanedDocuments(
		indexName: string
	): Promise<{ documentsRemoved: number; scanned: number }> {
		let offset = 0;
		let scanned = 0;
		let documentsRemoved = 0;
		let pending: string[] = [];

		/**
		 * Deletes buffered orphans in fixed-size requests, returning how many went.
		 *
		 * `drainAll` false leaves a partial batch buffered for the next page to fill, so requests
		 * stay a uniform size; true empties the buffer at the end of the walk. Each batch is capped
		 * rather than sent whole, because a page is four times the batch size and would otherwise
		 * arrive as one oversized request whenever a run of orphans fills it.
		 */
		const drain = async (drainAll: boolean): Promise<number> => {
			let removed = 0;
			while (pending.length >= DELETE_BATCH_SIZE || (drainAll && pending.length > 0)) {
				const batch = pending.splice(0, DELETE_BATCH_SIZE);
				const task = await this.#searchService.deleteDocuments(indexName, batch);
				await this.#searchService.waitForTask(task.taskUid);
				documentsRemoved += batch.length;
				removed += batch.length;
			}
			return removed;
		};

		for (;;) {
			const { ids } = await this.#searchService.getDocumentIds(indexName, {
				limit: SCAN_PAGE_SIZE,
				offset,
			});

			if (ids.length === 0) {
				break;
			}

			scanned += ids.length;
			const existing = await this.#findExistingIds(ids);
			pending.push(...ids.filter((id) => !existing.has(id)));

			const removedThisPage = await drain(false);

			// Everything deleted so far sat at or before this page, so those positions are gone.
			offset += ids.length - removedThisPage;

			if (ids.length < SCAN_PAGE_SIZE) {
				break;
			}
		}

		await drain(true);

		return { documentsRemoved, scanned };
	}

	/** The subset of the given ids that still have an `archived_emails` row. */
	async #findExistingIds(ids: string[]): Promise<Set<string>> {
		const existing = new Set<string>();

		for (let i = 0; i < ids.length; i += EXISTENCE_CHUNK_SIZE) {
			const chunk = ids.slice(i, i + EXISTENCE_CHUNK_SIZE);
			const rows = await db
				.select({ id: archivedEmails.id })
				.from(archivedEmails)
				.where(inArray(archivedEmails.id, chunk));
			for (const row of rows) {
				existing.add(row.id);
			}
		}

		return existing;
	}
}
