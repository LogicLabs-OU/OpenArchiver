import { db } from '../database';
import { ingestionSources } from '../database/schema';
import type {
	CreateIngestionSourceDto,
	UpdateIngestionSourceDto,
	IngestionSource,
	IngestionCredentials,
	OAuthMailboxCredentials,
	IngestionProvider,
	PendingEmail,
	ProcessEmailError,
} from '@open-archiver/types';
import {
	and,
	count,
	countDistinct,
	desc,
	eq,
	gte,
	inArray,
	max,
	min,
	notInArray,
	or,
	sql,
	type SQL,
} from 'drizzle-orm';
import { CryptoService } from './CryptoService';
import { EmailProviderFactory } from './EmailProviderFactory';
import { mergeOAuthCredentials, validateOAuthMailboxConfig } from './oauth/oauthHelpers';
import { ingestionQueue, indexingQueue } from '../jobs/queues';
import { continuousSyncJobId, initialImportJobId } from '../jobs/helpers/jobIds';
import { claimJobId } from '../jobs/helpers/claimJobId';
import type { JobType } from 'bullmq';
import { StorageService } from './StorageService';
import type {
	IInitialImportJob,
	EmailObject,
	ReindexMode,
	IReindexDispatch,
	IngestionStats,
} from '@open-archiver/types';
import { stripAttachmentsFromEml } from '../helpers/emlUtils';
import {
	archivedEmails,
	attachments as attachmentsSchema,
	emailAttachments,
} from '../database/schema';
import { createHash, randomUUID } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import { logger } from '../config/logger';
import { SearchService } from './SearchService';
import { config } from '../config/index';
import { FilterBuilder } from './FilterBuilder';
import { AuditService } from './AuditService';
import { User } from '@open-archiver/types';
import { checkDeletionEnabled } from '../helpers/deletionGuard';
import { normalizeEmailAddress } from '../helpers/emailAddress';
import { mapWithConcurrency } from '../helpers/mapWithConcurrency';
import { truncateToBytes } from '../helpers/truncateToBytes';
import { quoteMeiliString } from '../helpers/meiliFilter';
import { isIndexingWorkerAlive } from '../jobs/helpers/workerLiveness';
import { buildReindexWhere } from '../jobs/helpers/indexBacklog';

/** Placeholder used when an email has no parseable From address. sender_email is NOT NULL,
 * so inserting null (from a missing/unparseable sender, e.g. Exchange "Deleted Items"
 * system messages) would fail with Postgres 23502 and drop the email entirely. */
const UNKNOWN_SENDER = 'unknown@no-sender.invalid';

/**
 * How many of one email's attachments are stored at once. Small on purpose: this runs inside the
 * per-email concurrency of the mailbox loop, so the real parallelism is the product of the two.
 */
const ATTACHMENT_STORE_CONCURRENCY = 3;

/**
 * The mailbox column reduced to its canonical form.
 *
 * Rows archived before addresses were normalized on the way in still hold whatever casing and
 * padding the provider sent, so the column is reduced the same way the value was. Used for grouping
 * as well as matching: without it the same mailbox archived under two casings shows up as two rows
 * in the per-mailbox table and inflates `mailboxCount`.
 */
const normalizedMailbox = sql<string>`lower(btrim(${archivedEmails.userEmail}))`;

/**
 * Matches the mailbox column against an already-normalized address. Without this a provider that
 * changes the casing of a mailbox between syncs misses every dedup check and archives the whole
 * mailbox a second time.
 */
const matchesMailbox = (normalizedAddress: string) => eq(normalizedMailbox, normalizedAddress);

export class IngestionService {
	private static auditService = new AuditService();

	// ── Per-instance memo caches ──────────────────────────────────────────────
	// One IngestionService is constructed per process-mailbox job, so these live and die with the
	// mailbox. Every entry is invariant for the duration of that job: a source's merge topology and
	// its credentials do not change mid-sync, and an attachment's content hash maps to one row.
	//
	// Promises are cached rather than values, so that concurrent first callers — which now exist,
	// since a mailbox archives several emails at a time — collapse onto one query instead of racing
	// and each doing their own.
	private groupIdsCache = new Map<string, Promise<string[]>>();
	private effectiveSourceCache = new Map<string, Promise<IngestionSource>>();
	private attachmentIdCache = new Map<string, Promise<string>>();
	private static readonly ATTACHMENT_CACHE_MAX = 5_000;

	/**
	 * The Message-ID header as a string, or undefined when the email carries none usable.
	 *
	 * Exists so `dedupKeyFor` and `processEmail` cannot drift apart: the concurrency invariant is
	 * that emails serialized under the same key are exactly the emails that will collide at the
	 * dedup gate, and two independent copies of this unwrapping would only have to disagree once.
	 * The `typeof` guard covers the array branch too — a connector yielding a non-string there would
	 * otherwise reach `Buffer.byteLength` and throw outside any per-email catch, taking the whole
	 * mailbox down on one malformed header.
	 */
	private static messageIdHeaderOf(email: EmailObject): string | undefined {
		const header = email.headers.get('message-id');
		if (typeof header === 'string') {
			return header;
		}
		if (Array.isArray(header) && typeof header[0] === 'string') {
			return header[0];
		}
		return undefined;
	}

	/**
	 * The key an email will be deduplicated under, resolved without reading the message body.
	 *
	 * Callers that archive several emails from one mailbox concurrently need this: gate 1 in
	 * processEmail is a check-then-insert with no unique index behind it, so two emails carrying the
	 * same Message-ID (the same message filed in two folders, a Sent copy) would both find nothing
	 * and both insert. Serializing on this key is what keeps that impossible.
	 *
	 * `collapseGenerated` is for preserve-original (GoBD) sources. Those have a SECOND check-then-
	 * insert gate, on the sha256 of the raw message, which exists precisely for byte-identical
	 * emails whose Message-ID is missing or differs — and those are exactly the emails that fall to
	 * the per-message fallback key below and so would NOT serialize against each other. Collapsing
	 * every header-less email onto one shared key restores the serial loop's guarantee for that
	 * mode, at the cost of processing header-less messages one at a time.
	 *
	 * Elsewhere the fallback is exact rather than approximate: a generated key embeds `email.id`, so
	 * no two of them can collide and there is nothing to serialize.
	 */
	public static dedupKeyFor(email: EmailObject, collapseGenerated = false): string {
		const header = IngestionService.messageIdHeaderOf(email);
		if (header) {
			return IngestionService.boundMessageKey(header);
		}
		return collapseGenerated ? 'keyless' : `id:${email.id}`;
	}
	private static decryptSource(
		source: typeof ingestionSources.$inferSelect
	): IngestionSource | null {
		const decryptedCredentials = CryptoService.decryptObject<IngestionCredentials>(
			source.credentials as string
		);

		if (!decryptedCredentials) {
			logger.error(
				{ sourceId: source.id },
				'Failed to decrypt ingestion source credentials.'
			);
			return null;
		}

		return { ...source, credentials: decryptedCredentials } as IngestionSource;
	}

	public static returnFileBasedIngestions(): IngestionProvider[] {
		return ['pst_import', 'eml_import', 'mbox_import'];
	}

	public static async create(
		dto: CreateIngestionSourceDto,
		userId: string,
		actor: User,
		actorIp: string
	): Promise<IngestionSource> {
		const { providerConfig, mergedIntoId, ...rest } = dto;

		if (dto.provider === 'oauth_mailbox') {
			const validation = validateOAuthMailboxConfig(providerConfig);
			if (!validation.ok) {
				throw new Error(validation.message);
			}
			// Server-managed fields never arrive from a client. A crafted create carrying
			// its own tokens would otherwise skip authorization entirely.
			delete providerConfig.tokens;
			delete providerConfig.pendingAuth;
		}

		const encryptedCredentials = CryptoService.encryptObject(providerConfig);

		// Resolve merge target: if mergedIntoId points to a child, follow to the root.
		let resolvedMergedIntoId: string | undefined;
		if (mergedIntoId) {
			const target = await this.findById(mergedIntoId);
			resolvedMergedIntoId = target.mergedIntoId ?? target.id;
		}

		const valuesToInsert = {
			userId,
			...rest,
			status: 'pending_auth' as const,
			credentials: encryptedCredentials,
			mergedIntoId: resolvedMergedIntoId ?? null,
		};

		const [newSource] = await db.insert(ingestionSources).values(valuesToInsert).returning();

		await this.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'CREATE',
			targetType: 'IngestionSource',
			targetId: newSource.id,
			actorIp,
			details: {
				sourceName: newSource.name,
				sourceType: newSource.provider,
			},
		});

		const decryptedSource = this.decryptSource(newSource);
		if (!decryptedSource) {
			await this.delete(newSource.id, actor, actorIp, true);
			throw new Error(
				'Failed to process newly created ingestion source due to a decryption error.'
			);
		}
		// An OAuth mailbox has no tokens until its authorization flow completes, so there
		// is nothing to test yet — and the failure path below DELETES the source, which
		// would destroy the row the OAuth callback needs. It stays pending_auth (inert to
		// the scheduler) until the flow flips it to auth_success.
		if (decryptedSource.provider === 'oauth_mailbox') {
			return await this.update(
				decryptedSource.id,
				{ lastSyncStatusMessage: 'Waiting for mailbox authorization.' },
				actor,
				actorIp
			);
		}

		const connector = EmailProviderFactory.createConnector(decryptedSource);

		try {
			const connectionValid = await connector.testConnection();
			// If connection succeeds, update status to auth_success, which triggers the initial import.
			if (connectionValid) {
				return await this.update(
					decryptedSource.id,
					{ status: 'auth_success' },
					actor,
					actorIp
				);
			} else {
				throw Error('Ingestion authentication failed.');
			}
		} catch (error) {
			// If connection fails, delete the newly created source and throw the error.
			await this.delete(decryptedSource.id, actor, actorIp, true);
			throw error;
		}
	}

	public static async findAll(userId: string): Promise<IngestionSource[]> {
		const { drizzleFilter } = await FilterBuilder.create(userId, 'ingestion', 'read');
		let query = db.select().from(ingestionSources).$dynamic();

		if (drizzleFilter) {
			query = query.where(drizzleFilter);
		}

		// Sort alphabetically by name (case-insensitive) so large source lists and the source
		// dropdowns are navigable; createdAt is a stable tiebreaker for duplicate names (#407).
		const sources = await query.orderBy(
			sql`lower(${ingestionSources.name})`,
			desc(ingestionSources.createdAt)
		);
		return sources.flatMap((source) => {
			const decrypted = this.decryptSource(source);
			return decrypted ? [decrypted] : [];
		});
	}

	/**
	 * The stored row, without decrypting credentials.
	 *
	 * Permission checks only read plain columns (`id`, `userId`, `name`, `provider`, `status`), and
	 * a source whose credentials fail to decrypt must still be authorized rather than error.
	 */
	public static async findRowById(
		id: string
	): Promise<typeof ingestionSources.$inferSelect | undefined> {
		const [source] = await db
			.select()
			.from(ingestionSources)
			.where(eq(ingestionSources.id, id));
		return source;
	}

	public static async findById(id: string): Promise<IngestionSource> {
		const [source] = await db
			.select()
			.from(ingestionSources)
			.where(eq(ingestionSources.id, id));
		if (!source) {
			throw new Error('Ingestion source not found');
		}
		const decryptedSource = this.decryptSource(source);
		if (!decryptedSource) {
			throw new Error('Failed to decrypt ingestion source credentials.');
		}
		return decryptedSource;
	}

	/**
	 * Takes exclusive ownership of a source for one sync cycle, or reports that someone else has it.
	 *
	 * Reading the status and then writing it in a second statement is a check-then-act, and two
	 * `continuous-sync` jobs dispatched in the same tick both read `active` before either writes
	 * `syncing`. Both then proceeded, each created its own session, and the two sets of
	 * `process-mailbox` jobs raced the check-then-insert dedup in `processEmail` — which has no
	 * unique index behind it — and archived the same message twice, milliseconds apart. That is why
	 * sources of the same mailbox drift apart in email count while all of them report success.
	 *
	 * One conditional UPDATE closes it: PostgreSQL serializes the two writers on the row, the second
	 * sees the already-committed `syncing` and matches nothing. `RETURNING` gives the caller the row
	 * it just claimed, so nothing has to be re-read.
	 *
	 * @returns the claimed source, or null when another cycle already holds it.
	 */
	public static async claimForSync(id: string): Promise<IngestionSource | null> {
		const [claimed] = await db
			.update(ingestionSources)
			.set({ status: 'syncing', lastSyncStartedAt: new Date() })
			.where(
				and(
					eq(ingestionSources.id, id),
					inArray(ingestionSources.status, ['active', 'error'])
				)
			)
			.returning();

		if (!claimed) {
			return null;
		}

		const decryptedSource = this.decryptSource(claimed);
		if (!decryptedSource) {
			throw new Error('Failed to decrypt ingestion source credentials.');
		}
		return decryptedSource;
	}

	/**
	 * The initial-import counterpart of {@link claimForSync}.
	 *
	 * Excluded rather than included statuses, because an import is legitimate from every state a
	 * source can reach except one already running — a re-import of a `paused` or `imported` source is
	 * something the operator asks for explicitly, while `importing` and `syncing` mean a cycle is
	 * already in flight and a second would duplicate its work.
	 */
	public static async claimForImport(id: string): Promise<IngestionSource | null> {
		const [claimed] = await db
			.update(ingestionSources)
			.set({
				status: 'importing',
				lastSyncStartedAt: new Date(),
				lastSyncStatusMessage: 'Starting initial import...',
			})
			.where(
				and(
					eq(ingestionSources.id, id),
					notInArray(ingestionSources.status, ['importing', 'syncing'])
				)
			)
			.returning();

		if (!claimed) {
			return null;
		}

		const decryptedSource = this.decryptSource(claimed);
		if (!decryptedSource) {
			throw new Error('Failed to decrypt ingestion source credentials.');
		}
		return decryptedSource;
	}

	public static async update(
		id: string,
		dto: UpdateIngestionSourceDto,
		actor?: User,
		actorIp?: string
	): Promise<IngestionSource> {
		const { providerConfig, ...rest } = dto;
		const valuesToUpdate: Partial<typeof ingestionSources.$inferInsert> = { ...rest };

		// Get the original source to compare the status later
		const originalSource = await this.findById(id);

		if (providerConfig) {
			if (originalSource.provider === 'oauth_mailbox') {
				// The edit form starts blank (SafeIngestionSource omits credentials), so a
				// wholesale replace would wipe the tokens on every save. Merge instead:
				// server-managed fields carry over, a blank clientSecret keeps the stored
				// one, and only a change to WHO or WHERE to authenticate invalidates the
				// tokens and sends the source back to pending_auth for re-authorization.
				const { merged, connectionChanged } = mergeOAuthCredentials(
					originalSource.credentials as OAuthMailboxCredentials,
					providerConfig
				);
				if (connectionChanged) {
					const validation = validateOAuthMailboxConfig(merged);
					if (!validation.ok) {
						throw new Error(validation.message);
					}
					valuesToUpdate.status = 'pending_auth';
					valuesToUpdate.lastSyncStatusMessage =
						'Connection settings changed - re-authorization required.';
				}
				valuesToUpdate.credentials = CryptoService.encryptObject(merged);
			} else {
				// Encrypt the new credentials before updating
				valuesToUpdate.credentials = CryptoService.encryptObject(providerConfig);
			}
		}

		const [updatedSource] = await db
			.update(ingestionSources)
			.set(valuesToUpdate)
			.where(eq(ingestionSources.id, id))
			.returning();

		if (!updatedSource) {
			throw new Error('Ingestion source not found');
		}

		const decryptedSource = this.decryptSource(updatedSource);

		if (!decryptedSource) {
			throw new Error(
				'Failed to process updated ingestion source due to a decryption error.'
			);
		}

		// If the status has changed to auth_success, trigger the initial import
		if (originalSource.status !== 'auth_success' && decryptedSource.status === 'auth_success') {
			await this.triggerInitialImport(decryptedSource.id);
		}
		if (actor && actorIp) {
			const changedFields = Object.keys(dto).filter(
				(key) =>
					key !== 'providerConfig' &&
					originalSource[key as keyof IngestionSource] !==
						decryptedSource[key as keyof IngestionSource]
			);
			if (changedFields.length > 0) {
				await this.auditService.createAuditLog({
					actorIdentifier: actor.id,
					actionType: 'UPDATE',
					targetType: 'IngestionSource',
					targetId: id,
					actorIp,
					details: {
						changedFields,
					},
				});
			}
		}

		return decryptedSource;
	}

	/**
	 * Returns all ingestionSourceId values in a merge group given any member's ID.
	 * If the source is standalone (no parent, no children), returns just its own ID.
	 */
	public static async findGroupSourceIds(
		sourceId: string,
		known?: Pick<IngestionSource, 'id' | 'mergedIntoId'>
	): Promise<string[]> {
		// `known` lets a caller that already holds the row skip a second SELECT — and, more to the
		// point, a second AES decrypt of its credentials, which findById does on every call.
		const source = known ?? (await this.findById(sourceId));
		const rootId = source.mergedIntoId ?? source.id;

		const children = await db
			.select({ id: ingestionSources.id })
			.from(ingestionSources)
			.where(eq(ingestionSources.mergedIntoId, rootId));

		return [rootId, ...children.map((c) => c.id)];
	}

	/**
	 * Restricts a query to one merge group's archived emails.
	 *
	 * `inArray` handles a single-element list perfectly well, so the `length === 1 ? eq : inArray`
	 * ternary this replaces was branching for no reason — in nine separate copies.
	 */
	public static groupScopeFilter(sourceIds: string[]): SQL {
		return inArray(archivedEmails.ingestionSourceId, sourceIds);
	}

	/**
	 * Bulk id → name lookup for ingestion sources. Used to attach human-readable
	 * labels to counts computed elsewhere (e.g. Meilisearch facet distributions).
	 * Ids with no matching row are simply absent from the returned record.
	 */
	public static async getSourceNames(ids: string[]): Promise<Record<string, string>> {
		if (ids.length === 0) return {};
		const rows = await db
			.select({ id: ingestionSources.id, name: ingestionSources.name })
			.from(ingestionSources)
			.where(inArray(ingestionSources.id, ids));
		const map: Record<string, string> = {};
		for (const row of rows) {
			map[row.id] = row.name;
		}
		return map;
	}

	/**
	 * Detaches a child source from its merge group, making it standalone.
	 */
	public static async unmerge(
		id: string,
		actor: User,
		actorIp: string
	): Promise<IngestionSource> {
		const source = await this.findById(id);
		if (!source.mergedIntoId) {
			throw new Error('Source is not merged into another source.');
		}

		const [updated] = await db
			.update(ingestionSources)
			.set({ mergedIntoId: null })
			.where(eq(ingestionSources.id, id))
			.returning();

		await this.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'UPDATE',
			targetType: 'IngestionSource',
			targetId: id,
			actorIp,
			details: {
				action: 'unmerge',
				previousParentId: source.mergedIntoId,
			},
		});

		const decrypted = this.decryptSource(updated);
		if (!decrypted) {
			throw new Error('Failed to decrypt unmerged source.');
		}
		return decrypted;
	}

	public static async delete(
		id: string,
		actor: User,
		actorIp: string,
		force: boolean = false
	): Promise<IngestionSource> {
		if (!force) {
			checkDeletionEnabled();
		}
		const source = await this.findById(id);
		if (!source) {
			throw new Error('Ingestion source not found');
		}

		// If this is a root source with children, delete all children first
		if (!source.mergedIntoId) {
			const children = await db
				.select({ id: ingestionSources.id })
				.from(ingestionSources)
				.where(eq(ingestionSources.mergedIntoId, id));

			for (const child of children) {
				await this.delete(child.id, actor, actorIp, force);
			}
		}

		// Delete all emails and attachments from storage.
		// Path is keyed on the source ID only — the name is intentionally excluded
		// to ensure correctness even when the source was renamed after creation.
		const storage = new StorageService();
		const emailPath = `${config.storage.openArchiverFolderName}/${source.id}/`;
		await storage.delete(emailPath);

		if (
			(source.credentials.type === 'pst_import' ||
				source.credentials.type === 'eml_import' ||
				source.credentials.type === 'mbox_import') &&
			source.credentials.uploadedFilePath &&
			(await storage.exists(source.credentials.uploadedFilePath))
		) {
			await storage.delete(source.credentials.uploadedFilePath);
		}

		// Delete all emails from the database
		// NOTE: This is done by database CASADE, change when CASADE relation no longer exists.
		// await db.delete(archivedEmails).where(eq(archivedEmails.ingestionSourceId, id));

		// Delete all documents from Meilisearch.
		//
		// Waited to completion, and not merely enqueued: the rows below are removed by cascade the
		// moment this method returns, so a task that fails afterwards leaves documents describing
		// emails nothing can resolve, and search answers with results that cannot be opened (#446).
		// Failing here instead keeps the source and lets the caller retry. The id is quoted rather
		// than interpolated so a value carrying a quote cannot alter the filter.
		const searchService = new SearchService();
		const deletionTask = await searchService.deleteDocumentsByFilter(
			'emails',
			`ingestionSourceId = ${quoteMeiliString(id)}`
		);
		await searchService.waitForTask(deletionTask.taskUid);

		const [deletedSource] = await db
			.delete(ingestionSources)
			.where(eq(ingestionSources.id, id))
			.returning();

		await this.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'DELETE',
			targetType: 'IngestionSource',
			targetId: id,
			actorIp,
			details: {
				sourceName: deletedSource.name,
			},
		});

		const decryptedSource = this.decryptSource(deletedSource);
		if (!decryptedSource) {
			// Even if decryption fails, we should confirm deletion.
			// We might return a simpler object or just a success message.
			// For now, we'll indicate the issue but still confirm deletion happened.
			logger.warn(
				{ sourceId: deletedSource.id },
				'Could not decrypt credentials of deleted source, but deletion was successful.'
			);
			return { ...deletedSource, credentials: null } as unknown as IngestionSource;
		}
		return decryptedSource;
	}

	public static async triggerInitialImport(id: string): Promise<void> {
		const source = await this.findById(id);

		// A fixed job id, so a second import cannot be queued beside a running one, and so the
		// stale-source rescue can tell an abandoned import from one still enumerating mailboxes.
		// Claimed rather than merely added: BullMQ drops an add whose id still has a record, and a
		// completed record is retained, so without clearing it a later re-import would silently do
		// nothing — the failure mode behind #446.
		const alreadyRunning = await claimJobId(ingestionQueue, initialImportJobId(source.id));
		if (alreadyRunning) {
			logger.info(
				{ ingestionSourceId: source.id },
				'Initial import already queued or running - not starting a second one'
			);
			return;
		}

		await ingestionQueue.add(
			'initial-import',
			{ ingestionSourceId: source.id },
			{ jobId: initialImportJobId(source.id) }
		);
	}

	/**
	 * Enqueues a reindex of a single ingestion source (and its merge group).
	 * Rebuilds search documents from existing archived rows — never re-ingests.
	 * @param mode 'missing' (default) reindexes only emails not yet in the index;
	 *   'full' rebuilds every document for the source.
	 */
	public static async triggerReindex(
		id: string,
		mode: ReindexMode = 'missing'
	): Promise<IReindexDispatch> {
		const source = await this.findById(id);
		if (!source) {
			throw new Error('Ingestion source not found');
		}

		const groupIds = await this.findGroupSourceIds(id, source);
		const scopeFilter = this.groupScopeFilter(groupIds);
		const [pending, workerAlive] = await Promise.all([
			this.countReindexTargets(mode, scopeFilter),
			isIndexingWorkerAlive(),
		]);

		// attempts: 1 — the master reindex resets is_indexed=false before dispatching, so an
		// auto-retry would re-reset rows workers already re-indexed. A failed dispatch is
		// re-triggerable by hand and the periodic reconcile job backstops any gap. The
		// per-batch index-email-batch jobs keep the default retries (they are idempotent).
		await indexingQueue.add(
			'reindex',
			{
				scope: 'source',
				ingestionSourceId: source.id,
				mode,
			},
			{ attempts: 1 }
		);

		return { pending, workerAlive };
	}

	/**
	 * Enqueues a reindex of the entire archive across all sources.
	 * @param mode 'missing' (default) or 'full'.
	 */
	public static async triggerReindexAll(
		mode: ReindexMode = 'missing'
	): Promise<IReindexDispatch> {
		const [pending, workerAlive] = await Promise.all([
			this.countReindexTargets(mode),
			isIndexingWorkerAlive(),
		]);

		// attempts: 1 — see triggerReindex; the destructive is_indexed reset must not auto-retry.
		await indexingQueue.add('reindex', { scope: 'all', mode }, { attempts: 1 });

		return { pending, workerAlive };
	}

	/**
	 * How many emails the dispatched reindex job will hand to the indexer, using the same predicate
	 * the processor applies: `full` rebuilds everything in scope, `missing` only what the database
	 * believes is absent from the index.
	 *
	 * Counted here rather than reported by the job so the answer can travel back on the HTTP
	 * response. It is a snapshot — ingestion may add rows between this count and the job running —
	 * but the distinction that matters to a user, "some" versus "none at all", is exact.
	 */
	private static async countReindexTargets(
		mode: ReindexMode,
		scopeFilter?: SQL
	): Promise<number> {
		const [row] = await db
			.select({ total: count() })
			.from(archivedEmails)
			.where(buildReindexWhere(mode, scopeFilter));

		return row?.total ?? 0;
	}

	/**
	 * Index-health snapshot for a single source (and its merge group): how many
	 * emails are archived in the database vs. how many documents exist in the index.
	 * A gap indicates emails missing from search that a reindex can repair.
	 */
	public static async getIndexHealth(
		id: string
	): Promise<{ archivedCount: number; indexedCount: number }> {
		const groupIds = await this.findGroupSourceIds(id);
		const sourceFilter = IngestionService.groupScopeFilter(groupIds);

		// Count archived rows vs. rows the DB knows are indexed in a single scan.
		// `is_indexed` is set by IndexingService.markIndexed only after Meilisearch
		// confirms the write, so this is an exact, uncapped indexed count. (The global
		// dashboard health cross-checks the true Meili document count instead; per-source
		// we trust the flag, which is also what reindex/reconcile act on.)
		const [row] = await db
			.select({
				archivedCount: count(),
				indexedCount:
					sql<number>`count(*) filter (where ${archivedEmails.isIndexed})`.mapWith(
						Number
					),
			})
			.from(archivedEmails)
			.where(sourceFilter);

		return { archivedCount: row?.archivedCount ?? 0, indexedCount: row?.indexedCount ?? 0 };
	}

	/**
	 * Rich read-only statistics for a source, aggregated across its whole merge group.
	 * Backs the per-source statistics page. All queries are group-scoped.
	 */
	public static async getIngestionStats(id: string): Promise<IngestionStats> {
		const source = await this.findById(id);
		const rootId = source.mergedIntoId ?? source.id;
		const groupIds = await this.findGroupSourceIds(id);

		const emailFilter = IngestionService.groupScopeFilter(groupIds);
		const attachmentFilter = inArray(attachmentsSchema.ingestionSourceId, groupIds);

		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		// Run the independent aggregate queries concurrently.
		const [
			emailAggRows,
			physicalRows,
			attachmentAggRows,
			mailboxRows,
			mailboxBytesRows,
			children,
			recentActivity,
		] = await Promise.all([
			// Email aggregates in a single scan.
			db
				.select({
					totalEmails: count(),
					// Counted on the normalized address so one mailbox archived under two
					// casings is one mailbox, not two.
					mailboxCount: countDistinct(normalizedMailbox),
					threadCount: countDistinct(archivedEmails.threadId),
					firstEmailAt: min(archivedEmails.sentAt),
					lastEmailAt: max(archivedEmails.sentAt),
					journaledCount:
						sql<number>`count(*) filter (where ${archivedEmails.isJournaled})`.mapWith(
							Number
						),
					legalHoldCount:
						sql<number>`count(*) filter (where ${archivedEmails.isOnLegalHold})`.mapWith(
							Number
						),
					emailsWithAttachments:
						sql<number>`count(*) filter (where ${archivedEmails.hasAttachments})`.mapWith(
							Number
						),
					// Exact, uncapped index coverage from the DB `is_indexed` flag (set only
					// after Meilisearch confirms the write) — same source of truth reindex uses.
					indexedCount:
						sql<number>`count(*) filter (where ${archivedEmails.isIndexed})`.mapWith(
							Number
						),
				})
				.from(archivedEmails)
				.where(emailFilter),
			// Physical email storage: dedup by file hash so shared-file reference rows
			// (same physical .eml reused across mailboxes) are not double-counted.
			db
				.select({
					bytes: sql<number>`coalesce(sum(t.size_bytes), 0)`.mapWith(Number),
				})
				.from(
					sql`(select distinct ${archivedEmails.storageHashSha256} as hash, ${archivedEmails.sizeBytes} as size_bytes from ${archivedEmails} where ${emailFilter}) as t`
				),
			// Attachment aggregates (attachments are already deduplicated per root source).
			db
				.select({
					attachmentCount: count(),
					attachmentBytes:
						sql<number>`coalesce(sum(${attachmentsSchema.sizeBytes}), 0)`.mapWith(
							Number
						),
				})
				.from(attachmentsSchema)
				.where(attachmentFilter),
			// Per-mailbox email counts (raw, ordered by count desc). Storage is computed
			// separately below with hash-dedup so it matches the group `emailBytes` basis.
			db
				.select({
					userEmail: normalizedMailbox,
					emailCount: count(),
				})
				.from(archivedEmails)
				.where(emailFilter)
				.groupBy(normalizedMailbox)
				.orderBy(desc(count())),
			// Per-mailbox physical storage, deduplicated by file hash within each mailbox
			// (same methodology as the group-level `emailBytes`). A file shared across
			// different mailboxes is still attributed to each mailbox that received it, so
			// the parts can exceed the deduped group total — that is inherent to per-mailbox
			// attribution of shared storage.
			db
				.select({
					userEmail: sql<string>`t.user_email`,
					bytes: sql<number>`coalesce(sum(t.size_bytes), 0)`.mapWith(Number),
				})
				// Normalized to the same expression as the per-mailbox counts above: the two
				// results are joined on this value in JS, so normalizing only one of them would
				// make every lookup miss and report zero bytes for each mailbox.
				.from(
					sql`(select distinct ${normalizedMailbox} as user_email, ${archivedEmails.storageHashSha256} as hash, ${archivedEmails.sizeBytes} as size_bytes from ${archivedEmails} where ${emailFilter}) as t`
				)
				.groupBy(sql`t.user_email`),
			// Merge-group children metadata.
			db
				.select({
					id: ingestionSources.id,
					name: ingestionSources.name,
					provider: ingestionSources.provider,
					status: ingestionSources.status,
				})
				.from(ingestionSources)
				.where(eq(ingestionSources.mergedIntoId, rootId)),
			// Emails archived per day over the last 30 days.
			db
				.select({
					date: sql<string>`date_trunc('day', ${archivedEmails.archivedAt})`,
					count: count(),
				})
				.from(archivedEmails)
				.where(and(emailFilter, gte(archivedEmails.archivedAt, thirtyDaysAgo)))
				.groupBy(sql`date_trunc('day', ${archivedEmails.archivedAt})`)
				.orderBy(sql`date_trunc('day', ${archivedEmails.archivedAt})`),
		]);

		const emailAgg = emailAggRows[0];
		const emailBytes = physicalRows[0]?.bytes ?? 0;
		const attachmentBytes = attachmentAggRows[0]?.attachmentBytes ?? 0;

		// Merge the raw per-mailbox counts with the hash-deduped per-mailbox bytes.
		const bytesByMailbox = new Map(mailboxBytesRows.map((r) => [r.userEmail, r.bytes]));
		const mailboxes = mailboxRows.map((m) => ({
			userEmail: m.userEmail,
			emailCount: m.emailCount,
			bytes: bytesByMailbox.get(m.userEmail) ?? 0,
		}));

		return {
			sourceId: source.id,
			name: source.name,
			provider: source.provider,
			status: source.status,
			totalEmails: emailAgg?.totalEmails ?? 0,
			mailboxCount: emailAgg?.mailboxCount ?? 0,
			threadCount: emailAgg?.threadCount ?? 0,
			emailBytes,
			attachmentBytes,
			totalBytes: emailBytes + attachmentBytes,
			attachmentCount: attachmentAggRows[0]?.attachmentCount ?? 0,
			emailsWithAttachments: emailAgg?.emailsWithAttachments ?? 0,
			indexedCount: emailAgg?.indexedCount ?? 0,
			journaledCount: emailAgg?.journaledCount ?? 0,
			legalHoldCount: emailAgg?.legalHoldCount ?? 0,
			firstEmailAt: emailAgg?.firstEmailAt
				? new Date(emailAgg.firstEmailAt).toISOString()
				: null,
			lastEmailAt: emailAgg?.lastEmailAt
				? new Date(emailAgg.lastEmailAt).toISOString()
				: null,
			lastSyncStartedAt: source.lastSyncStartedAt ?? null,
			lastSyncFinishedAt: source.lastSyncFinishedAt ?? null,
			lastSyncStatusMessage: source.lastSyncStatusMessage ?? null,
			mailboxes,
			children,
			recentActivity,
		};
	}

	public static async triggerForceSync(id: string, actor: User, actorIp: string): Promise<void> {
		const source = await this.findById(id);
		logger.info({ ingestionSourceId: id }, 'Force syncing started.');
		if (!source) {
			throw new Error('Ingestion source not found');
		}

		// Clean up existing jobs for this source to break any stuck flows
		const jobTypes: JobType[] = ['active', 'waiting', 'failed', 'delayed', 'paused'];
		const jobs = await ingestionQueue.getJobs(jobTypes);
		for (const job of jobs) {
			if (job.data.ingestionSourceId === id) {
				try {
					await job.remove();
					logger.info(
						{ jobId: job.id, ingestionSourceId: id },
						'Removed stale job during force sync.'
					);
				} catch (error) {
					logger.error({ err: error, jobId: job.id }, 'Failed to remove stale job.');
				}
			}
		}

		// Reset status to 'active'
		await this.update(
			id,
			{
				status: 'active',
				lastSyncStatusMessage: 'Force sync triggered by user.',
			},
			actor,
			actorIp
		);

		await this.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'SYNC',
			targetType: 'IngestionSource',
			targetId: id,
			actorIp,
			details: {
				sourceName: source.name,
			},
		});

		// Same per-source job id the scheduler uses, so a force sync pressed while a cycle is already
		// running joins it instead of starting a competing one.
		await ingestionQueue.add(
			'continuous-sync',
			{ ingestionSourceId: source.id },
			{
				jobId: continuousSyncJobId(source.id),
				removeOnComplete: true,
				removeOnFail: true,
			}
		);

		// If this is a root source, also trigger sync for all non-file-based active/error children
		if (!source.mergedIntoId) {
			const fileBasedProviders = this.returnFileBasedIngestions();
			const children = await db
				.select({
					id: ingestionSources.id,
					provider: ingestionSources.provider,
					status: ingestionSources.status,
				})
				.from(ingestionSources)
				.where(eq(ingestionSources.mergedIntoId, id));

			for (const child of children) {
				if (
					!fileBasedProviders.includes(child.provider) &&
					(child.status === 'active' || child.status === 'error')
				) {
					logger.info(
						{ childId: child.id, parentId: id },
						'Cascading force sync to child source.'
					);
					await ingestionQueue.add(
						'continuous-sync',
						{ ingestionSourceId: child.id },
						{
							jobId: continuousSyncJobId(child.id),
							removeOnComplete: true,
							removeOnFail: true,
						}
					);
				}
			}
		}
	}

	public static async performBulkImport(
		job: IInitialImportJob,
		actor: User,
		actorIp: string
	): Promise<void> {
		const { ingestionSourceId } = job;
		const source = await IngestionService.findById(ingestionSourceId);
		if (!source) {
			throw new Error(`Ingestion source ${ingestionSourceId} not found.`);
		}

		logger.info(`Starting bulk import for source: ${source.name} (${source.id})`);
		await IngestionService.update(
			ingestionSourceId,
			{
				status: 'importing',
				lastSyncStartedAt: new Date(),
			},
			actor,
			actorIp
		);

		const connector = EmailProviderFactory.createConnector(source);

		try {
			if (connector.listAllUsers) {
				// For multi-mailbox providers, dispatch a job for each user
				for await (const user of connector.listAllUsers()) {
					// Normalized here so the mailbox identity is canonical before it is queued.
					const userEmail = user.primaryEmail
						? normalizeEmailAddress(user.primaryEmail)
						: '';
					if (userEmail) {
						await ingestionQueue.add('process-mailbox', {
							ingestionSourceId: source.id,
							userEmail: userEmail,
						});
					}
				}
			} else {
				// For single-mailbox providers, dispatch a single job
				await ingestionQueue.add('process-mailbox', {
					ingestionSourceId: source.id,
					userEmail:
						source.credentials.type === 'generic_imap'
							? normalizeEmailAddress(source.credentials.username)
							: 'default',
				});
			}
		} catch (error) {
			logger.error(`Bulk import failed for source: ${source.name} (${source.id})`, error);
			await IngestionService.update(
				ingestionSourceId,
				{
					status: 'error',
					lastSyncFinishedAt: new Date(),
					lastSyncStatusMessage:
						error instanceof Error ? error.message : 'An unknown error occurred.',
				},
				actor,
				actorIp
			);
			throw error; // Re-throw to allow BullMQ to handle the job failure
		}
	}

	/**
	 * Pre-fetch duplicate check to avoid unnecessary API calls during ingestion.
	 * Checks both providerMessageId (for Google/Microsoft API IDs) and
	 * messageIdHeader (for IMAP/PST/EML/Mbox RFC Message-IDs and pre-migration rows).
	 *
	 * The check is scoped to a specific mailbox (userEmail) within the merge group.
	 * This allows different mailbox owners to each get their own archived_emails row
	 * for the same physical email — only skipping the download when this particular
	 * mailbox already has the email.
	 */
	public static async doesEmailExist(
		rawMessageId: string,
		ingestionSourceId: string,
		rawUserEmail: string,
		knownGroupIds?: string[]
	): Promise<boolean> {
		// Bounded on the way in so this pre-fetch check compares against the same key processEmail
		// stored. Without it an over-long id would look absent here and be downloaded again on
		// every sync.
		const messageId = IngestionService.boundMessageKey(rawMessageId);
		const userEmail = normalizeEmailAddress(rawUserEmail);
		// The group is invariant for a whole mailbox job, so the caller resolves it once and passes
		// it in. Without that this ran a SELECT for every message the connector offered — before the
		// message was even downloaded.
		const groupIds = knownGroupIds ?? (await this.findGroupSourceIds(ingestionSourceId));
		const sourceFilter = IngestionService.groupScopeFilter(groupIds);

		const existingEmail = await db.query.archivedEmails.findFirst({
			where: and(
				sourceFilter,
				matchesMailbox(userEmail),
				or(
					eq(archivedEmails.providerMessageId, messageId),
					eq(archivedEmails.messageIdHeader, messageId)
				)
			),
			columns: { id: true },
		});
		return !!existingEmail;
	}

	/**
	 * Builds the filesystem-safe filename component for an email's .eml from its id.
	 * The provider id / Message-ID becomes an actual filename, but Exchange-style ids can
	 * exceed the 255-byte filename limit or contain '/', producing ENAMETOOLONG / bad-path
	 * mkdir errors that drop the email (#405). When the id is unsafe we substitute its
	 * sha256 hash; archived_emails.message_id_header still holds the Message-ID, clamped by
	 * boundMessageKey only in the pathological case, and the stored .eml always holds the header
	 * exactly as it arrived. Short, safe ids are left as-is so common filenames stay
	 * human-readable.
	 *
	 * Byte budget: the last folder segment of email.path is glued into the SAME path
	 * component as this filename (`${sanitizedPath}${fileName}.eml` with no separator), so
	 * the two share the 255-byte limit: folder segment ≤ PATH_SEGMENT_MAX_BYTES (100 + 9
	 * hash suffix) + id ≤ EMAIL_ID_MAX_BYTES (140) + '.eml' (4) = 253 bytes worst case.
	 * Lengths are measured in BYTES (Buffer.byteLength), not chars — a 140-char multibyte
	 * id can be several times that in bytes.
	 */
	private buildEmailFileName(id: string): string {
		if (Buffer.byteLength(id) <= IngestionService.EMAIL_ID_MAX_BYTES && !/[/\\]/.test(id)) {
			return id;
		}
		return createHash('sha256').update(id).digest('hex');
	}

	/** See buildEmailFileName's byte-budget comment for how these two limits interact. */
	private static readonly EMAIL_ID_MAX_BYTES = 140;
	private static readonly PATH_SEGMENT_MAX_BYTES = 100;

	/**
	 * RFC 5322 caps a header line at 998 octets, so a Message-ID longer than this is already
	 * malformed. The number that actually matters is the ceiling it stays under: both dedup keys
	 * sit in a btree (`msgid_header_source_idx`, `provider_msg_source_idx`), and PostgreSQL refuses
	 * an index tuple over 8191 bytes and a btree tuple over roughly 2704. 998 plus the uuid beside
	 * it clears both with room to spare.
	 */
	private static readonly MESSAGE_KEY_MAX_BYTES = 998;

	/**
	 * Clamps a value used as a deduplication key — the Message-ID header, or the provider id, which
	 * for IMAP and the file-based connectors is the Message-ID header again.
	 *
	 * A hostile or malformed Message-ID can run to kilobytes. Stored raw it made the whole INSERT
	 * fail with "index row requires N bytes, maximum size is 8191", so the email was never archived
	 * and failed identically on every retry (#440). The column itself has no limit; the btree
	 * indexes over it do.
	 *
	 * The sha256 suffix is the part that matters for correctness. Truncating alone would let two
	 * different messages that share a long prefix collapse into one dedup key, and the second would
	 * be discarded as a duplicate — a silent loss, which is the one outcome an archive must not
	 * have. The full header is untouched in the stored .eml either way.
	 */
	private static boundMessageKey(value: string): string {
		if (Buffer.byteLength(value) <= IngestionService.MESSAGE_KEY_MAX_BYTES) {
			return value;
		}
		const digest = createHash('sha256').update(value).digest('hex');
		const truncated = truncateToBytes(
			value,
			IngestionService.MESSAGE_KEY_MAX_BYTES - digest.length - 1
		);
		return `${truncated}-${digest}`;
	}

	/**
	 * Clamps one folder segment of email.path for use in a storage path. Folder names come
	 * from mail servers / PST files and can exceed the 255-byte per-component filesystem
	 * limit (#405). Over-long segments are byte-truncated with a short sha256 suffix of the
	 * original so distinct folders stay distinct. The original path is still stored
	 * unmodified in archived_emails.path.
	 */
	private clampPathSegment(segment: string): string {
		if (Buffer.byteLength(segment) <= IngestionService.PATH_SEGMENT_MAX_BYTES) {
			return segment;
		}
		const truncated = truncateToBytes(segment, IngestionService.PATH_SEGMENT_MAX_BYTES);
		return `${truncated}-${createHash('sha256').update(segment).digest('hex').slice(0, 8)}`;
	}

	/**
	 * Builds the filesystem-safe filename component for a stored attachment (#405).
	 * attachment.filename comes straight from parsed MIME headers — sender-controlled — so
	 * it can exceed the 255-byte filename limit (ENAMETOOLONG drops the whole email) or
	 * contain '/', '\' or '..' segments that would create unintended directories or escape
	 * the source's attachments folder entirely. Sanitizes separators/control chars, keeps
	 * short names as-is for readability, and byte-truncates long ones with a short sha256
	 * suffix of the original name, preserving the extension. The original filename is still
	 * stored unmodified in the attachments.filename column.
	 */
	private buildAttachmentFileName(filename: string): string {
		const sanitized = filename.replace(/[/\\\u0000-\u001f]/g, '_');
		// 180-byte cap + the 8-byte `uniqueId-` prefix stays well under the 255-byte limit.
		if (Buffer.byteLength(sanitized) <= 180) {
			return sanitized;
		}
		// Split off a real extension (≤ 16 bytes); otherwise treat the name as extensionless.
		const dotIndex = sanitized.lastIndexOf('.');
		let base = sanitized;
		let ext = '';
		if (dotIndex > 0 && Buffer.byteLength(sanitized.slice(dotIndex)) <= 16) {
			base = sanitized.slice(0, dotIndex);
			ext = sanitized.slice(dotIndex);
		}
		const hashSuffix = createHash('sha256').update(filename).digest('hex').slice(0, 8);
		const budget = 180 - Buffer.byteLength(`-${hashSuffix}${ext}`);
		return `${truncateToBytes(base, budget)}-${hashSuffix}${ext}`;
	}

	/**
	 * The merge group's source ids, resolved once per source per job.
	 *
	 * findGroupSourceIds costs a SELECT — and, when the source is a merge child, a findById whose
	 * AES credential decrypt is the expensive part. This ran on every single email.
	 *
	 * Public so the mailbox processor's duplicate pre-check warms and shares this exact memo rather
	 * than resolving the group through a second, separate path. The tradeoff, accepted: a merge or
	 * unmerge performed while a mailbox is mid-import is not seen until that job ends, so the
	 * remaining emails of the run miss the shared-file reference check and store their own copy.
	 * Rare, self-correcting on the next sync, and cheaper than a SELECT per message.
	 */
	public resolveGroupSourceIds(source: IngestionSource): Promise<string[]> {
		const cached = this.groupIdsCache.get(source.id);
		if (cached) {
			return cached;
		}
		// `source` is already in hand, so pass it as `known` and skip the findById entirely.
		const resolved = IngestionService.findGroupSourceIds(source.id, source);
		this.groupIdsCache.set(source.id, resolved);
		// A failure must not be remembered as the answer: a transient database blip would otherwise
		// be re-thrown at every remaining email in the mailbox instead of being retried once.
		resolved.catch(() => this.groupIdsCache.delete(source.id));
		return resolved;
	}

	/**
	 * The root source that owns storage and DB rows for a merge child, resolved once per job.
	 *
	 * findById decrypts the source's credentials every call, so doing this per email spent real CPU
	 * re-deriving a value that is fixed for the whole mailbox.
	 */
	private resolveEffectiveSource(mergedIntoId: string): Promise<IngestionSource> {
		const cached = this.effectiveSourceCache.get(mergedIntoId);
		if (cached) {
			return cached;
		}
		const resolved = IngestionService.findById(mergedIntoId);
		this.effectiveSourceCache.set(mergedIntoId, resolved);
		resolved.catch(() => this.effectiveSourceCache.delete(mergedIntoId));
		return resolved;
	}

	/**
	 * The attachments row id for a piece of content, created if this is the first sighting.
	 *
	 * The cache turns a repeated attachment — a signature image, a company letterhead — into one
	 * lookup per job instead of one per email carrying it. Because the promise is stored BEFORE it
	 * is awaited, two emails archived at the same time that share an attachment also serialize onto
	 * the same insert instead of both finding nothing and both inserting.
	 *
	 * That guarantee covers THIS job only. `attachments` has no unique index on
	 * (ingestion_source_id, content_hash_sha256) — only the plain `source_hash_idx` — so sibling
	 * mailbox jobs of the same source, a stalled job re-delivered to another slot, and any second
	 * replica still race each other and can still produce duplicate rows. That race predates the
	 * per-mailbox concurrency; closing it properly needs the unique index plus
	 * `onConflictDoNothing()` and a re-select, which is a migration and a follow-up.
	 *
	 * One consequence of sharing worth knowing: when the shared attempt fails, every email waiting
	 * on it fails with it, where previously each retried on its own. Accepted — the rejection
	 * evicts the entry, so the next email through does retry.
	 */
	private getOrCreateAttachmentId(
		attachmentHash: string,
		effectiveSourceId: string,
		attachment: EmailObject['attachments'][number],
		storage: StorageService
	): Promise<string> {
		const cacheKey = `${effectiveSourceId}:${attachmentHash}`;
		const cached = this.attachmentIdCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const resolved = (async (): Promise<string> => {
			const existingAttachment = await db.query.attachments.findFirst({
				where: and(
					eq(attachmentsSchema.contentHashSha256, attachmentHash),
					eq(attachmentsSchema.ingestionSourceId, effectiveSourceId)
				),
			});

			if (existingAttachment) {
				logger.debug(
					{
						attachmentHash,
						ingestionSourceId: effectiveSourceId,
						reusedPath: existingAttachment.storagePath,
					},
					'Reusing existing attachment file for deduplication.'
				);
				return existingAttachment.id;
			}

			// New attachment: store under the root source's folder. Path uses the source ID only —
			// not the name — so that renaming a source never causes a path mismatch.
			const uniqueId = randomUUID().slice(0, 7);
			const storagePath = `${config.storage.openArchiverFolderName}/${effectiveSourceId}/attachments/${uniqueId}-${this.buildAttachmentFileName(attachment.filename)}`;
			await storage.put(storagePath, attachment.content);

			const [newRecord] = await db
				.insert(attachmentsSchema)
				.values({
					filename: attachment.filename,
					mimeType: attachment.contentType,
					sizeBytes: attachment.size,
					contentHashSha256: attachmentHash,
					storagePath,
					// Always assign attachment ownership to root (effectiveSource)
					ingestionSourceId: effectiveSourceId,
				})
				.returning();
			return newRecord.id;
		})();

		// Bounded: an import of mostly-distinct attachments would otherwise retain one entry per
		// attachment for the life of the job, times every mailbox running in parallel, in a worker
		// with no heap ceiling. Map iterates in insertion order, so the first key is the oldest;
		// evicting it costs at worst one repeated lookup.
		if (this.attachmentIdCache.size >= IngestionService.ATTACHMENT_CACHE_MAX) {
			const oldest = this.attachmentIdCache.keys().next();
			if (!oldest.done) {
				this.attachmentIdCache.delete(oldest.value);
			}
		}
		this.attachmentIdCache.set(cacheKey, resolved);
		// A failed store must not be remembered as the answer for the rest of the job.
		resolved.catch(() => this.attachmentIdCache.delete(cacheKey));
		return resolved;
	}

	/**
	 * @param skipTempFileCleanup When true, the caller is responsible for deleting
	 *   email.tempFilePath. Used by the journaling fan-out loop which calls
	 *   processEmail() multiple times with the same EmailObject — only the last
	 *   caller should clean up the temp file.
	 * @returns The pending email on success, `null` when the email was deduplicated /
	 *   intentionally skipped, or a ProcessEmailError when archiving failed. Callers must
	 *   count error returns towards their failure totals — treating them as skips is what
	 *   allowed silent data loss to report success (#403).
	 */
	public async processEmail(
		email: EmailObject,
		source: IngestionSource,
		storage: StorageService,
		rawUserEmail: string,
		skipTempFileCleanup: boolean = false
	): Promise<PendingEmail | ProcessEmailError | null> {
		// Normalized once here so the dedup gates and all three inserts below agree on what
		// counts as the same mailbox, whatever casing or padding the provider sent.
		const userEmail = normalizeEmailAddress(rawUserEmail);
		try {
			// Read the raw bytes from the temp file written by the connector
			const rawEmlBuffer = await readFile(email.tempFilePath);

			// If this source is a child in a merge group, redirect all storage and DB
			// ownership to the root source. Child sources are "assistants" — they fetch
			// emails on behalf of the root but never own any stored content.
			const effectiveSource = source.mergedIntoId
				? await this.resolveEffectiveSource(source.mergedIntoId)
				: source;

			// Generate a unique message ID for the email. If the email already has a message-id header, use that.
			// Otherwise, generate a new one based on the email's hash, source ID, and email ID.
			let messageId = IngestionService.messageIdHeaderOf(email);
			if (!messageId) {
				messageId = `generated-${createHash('sha256')
					.update(rawEmlBuffer)
					.digest('hex')}-${source.id}-${email.id}`;
			}
			// Both keys are bounded here, once, so the two dedup gates below and all three inserts
			// agree on them (#440). The provider id needs it as much as the header does: for IMAP
			// and the file-based connectors email.id IS the parsed Message-ID, and it lands in a
			// btree of its own via provider_msg_source_idx.
			messageId = IngestionService.boundMessageKey(messageId);
			const providerMessageId = IngestionService.boundMessageKey(email.id);
			// ── Three-gate deduplication ──────────────────────────────────────
			// Gate 1: Per-mailbox idempotency — has THIS mailbox already archived
			//         this email? If so, skip entirely (handles re-sync / retry).
			// Gate 2: Shared-file reference — does the email exist in ANOTHER
			//         mailbox within the merge group? If so, skip file write and
			//         create a reference row pointing to the existing storagePath.
			// Gate 3: Full new ingestion — first time this email is seen anywhere
			//         in the group. Write file + create row.
			// ─────────────────────────────────────────────────────────────────

			const groupIds = await this.resolveGroupSourceIds(source);
			const groupSourceFilter = IngestionService.groupScopeFilter(groupIds);

			// Gates 1 and 2 in one round trip. They ask the same index the same question and differ
			// only by the mailbox predicate, so ordering this mailbox's row first answers both: if
			// the row that comes back belongs to this mailbox it is gate 1, and if one exists at all
			// but belongs to another mailbox it is gate 2. Two queries per email were one more than
			// the question needed.
			// Postgres both orders on and returns the mailbox predicate, so the answer to gate 1 is
			// the one the database computed — not a second opinion formed in JavaScript, which
			// would have to reproduce btrim's exact idea of whitespace to stay in agreement.
			const isThisMailbox = sql<boolean>`${normalizedMailbox} = ${userEmail}`;
			const groupMatch = await db.query.archivedEmails.findFirst({
				where: and(eq(archivedEmails.messageIdHeader, messageId), groupSourceFilter),
				columns: {
					id: true,
					storagePath: true,
					storageHashSha256: true,
					sizeBytes: true,
					hasAttachments: true,
				},
				extras: {
					isThisMailbox: isThisMailbox.as('is_this_mailbox'),
				},
				orderBy: desc(isThisMailbox),
			});

			// Gate 1: Per-mailbox duplicate check (idempotency guard for re-sync)
			if (groupMatch?.isThisMailbox) {
				logger.debug(
					{ messageId, userEmail, ingestionSourceId: source.id },
					'Skipping duplicate email (same mailbox already has this email)'
				);
				return null;
			}

			// Gate 2: Another mailbox in the group already has this email. Skip the file write and
			// create a reference row sharing the existing storagePath and storageHashSha256.
			const existingGroupEmail = groupMatch;

			if (existingGroupEmail) {
				// Shared-file reference path: no file write, just a new DB row
				// pointing to the same physical storagePath.
				const [referenceRow] = await db
					.insert(archivedEmails)
					.values({
						ingestionSourceId: effectiveSource.id,
						userEmail,
						threadId: email.threadId,
						messageIdHeader: messageId,
						providerMessageId,
						sentAt: email.receivedAt,
						subject: email.subject,
						senderName: email.from[0]?.name,
						senderEmail: email.from[0]?.address || UNKNOWN_SENDER,
						recipients: {
							to: email.to,
							cc: email.cc,
							bcc: email.bcc ?? [],
						},
						// Re-use existing physical file and hash
						storagePath: existingGroupEmail.storagePath,
						storageHashSha256: existingGroupEmail.storageHashSha256,
						sizeBytes: existingGroupEmail.sizeBytes,
						hasAttachments: existingGroupEmail.hasAttachments,
						isJournaled: effectiveSource.provider === 'smtp_journaling',
						path: email.path,
						tags: email.tags,
					})
					.returning();

				// Copy attachment links from the existing email to this reference row
				// so that per-mailbox attachment queries return correct results.
				if (existingGroupEmail.hasAttachments) {
					const existingLinks = await db
						.select({ attachmentId: emailAttachments.attachmentId })
						.from(emailAttachments)
						.where(eq(emailAttachments.emailId, existingGroupEmail.id));

					if (existingLinks.length > 0) {
						await db
							.insert(emailAttachments)
							.values(
								existingLinks.map((link) => ({
									emailId: referenceRow.id,
									attachmentId: link.attachmentId,
								}))
							)
							.onConflictDoNothing();
					}
				}

				logger.debug(
					{
						messageId,
						userEmail,
						existingEmailId: existingGroupEmail.id,
						referenceEmailId: referenceRow.id,
					},
					'Created shared-file reference row for another mailbox owner'
				);

				return {
					archivedEmailId: referenceRow.id,
				};
			}

			// Gate 3: Full new ingestion — first time this email is seen in the group.
			// Clamp each folder segment so server-provided folder names cannot exceed the
			// per-component filesystem limit (#405). The original path is stored in the DB row.
			const sanitizedPath = email.path
				? email.path
						.split('/')
						.map((segment) => this.clampPathSegment(segment))
						.join('/')
				: '';
			// Use effectiveSource (root) for storage path and DB ownership.
			// Child sources are assistants; all content physically belongs to the root.
			// Path uses the source ID only — not the name — so that renaming a source
			// never causes a path mismatch between old and newly stored files.
			const emailPath = `${config.storage.openArchiverFolderName}/${effectiveSource.id}/emails/${sanitizedPath}${this.buildEmailFileName(email.id)}.eml`;

			// GoBD / Preserve Original File mode: store the unmodified raw EML as-is.
			// No attachment stripping, no attachment table records — the full MIME body
			// including attachments is preserved in the single .eml file.
			// Use the root (effectiveSource) compliance mode as authoritative.
			if (effectiveSource.preserveOriginalFile) {
				const emailHash = createHash('sha256').update(rawEmlBuffer).digest('hex');

				// Hash-level deduplication within the root source — catches emails
				// with different or missing Message-IDs that are byte-identical.
				const hashDuplicate = await db.query.archivedEmails.findFirst({
					where: and(
						eq(archivedEmails.storageHashSha256, emailHash),
						matchesMailbox(userEmail),
						eq(archivedEmails.ingestionSourceId, effectiveSource.id)
					),
					columns: { id: true },
				});

				if (hashDuplicate) {
					logger.debug(
						{ emailHash, userEmail, ingestionSourceId: effectiveSource.id },
						'Skipping duplicate email (hash-level dedup, preserve original mode)'
					);
					return null;
				}

				// Check if the same hash exists for a DIFFERENT mailbox — share the file
				const hashExistingOther = await db.query.archivedEmails.findFirst({
					where: and(
						eq(archivedEmails.storageHashSha256, emailHash),
						eq(archivedEmails.ingestionSourceId, effectiveSource.id)
					),
				});

				let storagePath: string;
				if (hashExistingOther) {
					// File already on disk — create a reference row
					storagePath = hashExistingOther.storagePath;
				} else {
					// First occurrence — store the unmodified raw buffer
					storagePath = emailPath;
					await storage.put(emailPath, rawEmlBuffer);
				}

				const [archivedEmail] = await db
					.insert(archivedEmails)
					.values({
						ingestionSourceId: effectiveSource.id,
						userEmail,
						threadId: email.threadId,
						messageIdHeader: messageId,
						providerMessageId,
						sentAt: email.receivedAt,
						subject: email.subject,
						senderName: email.from[0]?.name,
						senderEmail: email.from[0]?.address || UNKNOWN_SENDER,
						recipients: {
							to: email.to,
							cc: email.cc,
							bcc: email.bcc ?? [],
						},
						storagePath,
						storageHashSha256: emailHash,
						sizeBytes: rawEmlBuffer.length,
						hasAttachments: email.attachments.length > 0,
						isJournaled: effectiveSource.provider === 'smtp_journaling',
						path: email.path,
						tags: email.tags,
					})
					.returning();

				return {
					archivedEmailId: archivedEmail.id,
				};
			}

			// Default mode: strip non-inline attachments from the .eml to avoid double-storing
			// attachment data (attachments are stored separately).
			const emlBuffer = await stripAttachmentsFromEml(rawEmlBuffer);
			const emailHash = createHash('sha256').update(emlBuffer).digest('hex');
			await storage.put(emailPath, emlBuffer);

			const [archivedEmail] = await db
				.insert(archivedEmails)
				.values({
					ingestionSourceId: effectiveSource.id,
					userEmail,
					threadId: email.threadId,
					messageIdHeader: messageId,
					providerMessageId,
					sentAt: email.receivedAt,
					subject: email.subject,
					senderName: email.from[0]?.name,
					senderEmail: email.from[0]?.address || UNKNOWN_SENDER,
					recipients: {
						to: email.to,
						cc: email.cc,
						bcc: email.bcc ?? [],
					},
					storagePath: emailPath,
					storageHashSha256: emailHash,
					sizeBytes: emlBuffer.length,
					hasAttachments: email.attachments.length > 0,
					isJournaled: effectiveSource.provider === 'smtp_journaling',
					path: email.path,
					tags: email.tags,
				})
				.returning();

			if (email.attachments.length > 0) {
				// Each attachment stores and links itself, and does so as soon as its own id is
				// known. Collecting every id first and writing the links in one insert at the end
				// read better but lost data: an email whose last attachment failed committed NO
				// links at all, while its row was already inserted with has_attachments = true and
				// the per-mailbox dedup gate would skip the email on every later sync — leaving it
				// permanently showing attachments it cannot list.
				//
				// Bounded parallelism because each of these is a storage round trip. Two
				// attachments of the same content resolve through one cached promise, so the
				// second link insert simply finds its row already there.
				const results = await mapWithConcurrency(
					email.attachments,
					ATTACHMENT_STORE_CONCURRENCY,
					async (attachment) => {
						const attachmentHash = createHash('sha256')
							.update(attachment.content)
							.digest('hex');
						const attachmentId = await this.getOrCreateAttachmentId(
							attachmentHash,
							effectiveSource.id,
							attachment,
							storage
						);
						await db
							.insert(emailAttachments)
							.values({ emailId: archivedEmail.id, attachmentId })
							.onConflictDoNothing();
					}
				);

				// Surfaced after the successful links are committed, so partial progress survives
				// while the email is still reported as failed — same outcome the sequential loop
				// produced, and what the caller's error accounting expects.
				const failure = results.find((r) => r.status === 'rejected');
				if (failure?.status === 'rejected') {
					throw failure.reason;
				}
			}

			return {
				archivedEmailId: archivedEmail.id,
			};
		} catch (error) {
			logger.error({
				message: `Failed to process email ${email.id} for source ${source.id}`,
				error,
				emailId: email.id,
				ingestionSourceId: source.id,
			});
			// Return a distinct error object rather than null so callers can count
			// genuine failures separately from dedup skips (#403).
			return {
				error: true,
				message: `Email ${email.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
			};
		} finally {
			// Clean up the temp file unless the caller opted out (e.g. journaling
			// fan-out loop that calls processEmail() multiple times with the same
			// EmailObject — temp file must survive until the last call finishes).
			if (!skipTempFileCleanup) {
				await unlink(email.tempFilePath).catch((err) =>
					logger.warn(
						{ err, tempFilePath: email.tempFilePath },
						'Failed to delete temp email file'
					)
				);
			}
		}
	}
}
