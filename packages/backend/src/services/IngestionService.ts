import { db } from '../database';
import { ingestionSources } from '../database/schema';
import type {
	CreateIngestionSourceDto,
	UpdateIngestionSourceDto,
	IngestionSource,
	IngestionCredentials,
	IngestionProvider,
	PendingEmail,
	ProcessEmailError,
} from '@open-archiver/types';
import { and, count, countDistinct, desc, eq, gte, inArray, max, min, or, sql } from 'drizzle-orm';
import { CryptoService } from './CryptoService';
import { EmailProviderFactory } from './EmailProviderFactory';
import { ingestionQueue, indexingQueue } from '../jobs/queues';
import type { JobType } from 'bullmq';
import { StorageService } from './StorageService';
import type {
	IInitialImportJob,
	EmailObject,
	ReindexMode,
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

/** Placeholder used when an email has no parseable From address. sender_email is NOT NULL,
 * so inserting null (from a missing/unparseable sender, e.g. Exchange "Deleted Items"
 * system messages) would fail with Postgres 23502 and drop the email entirely. */
const UNKNOWN_SENDER = 'unknown@no-sender.invalid';

export class IngestionService {
	private static auditService = new AuditService();
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
			// Encrypt the new credentials before updating
			valuesToUpdate.credentials = CryptoService.encryptObject(providerConfig);
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
	public static async findGroupSourceIds(sourceId: string): Promise<string[]> {
		const source = await this.findById(sourceId);
		const rootId = source.mergedIntoId ?? source.id;

		const children = await db
			.select({ id: ingestionSources.id })
			.from(ingestionSources)
			.where(eq(ingestionSources.mergedIntoId, rootId));

		return [rootId, ...children.map((c) => c.id)];
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

		// Delete all documents from Meilisearch
		const searchService = new SearchService();
		await searchService.deleteDocumentsByFilter('emails', `ingestionSourceId = ${id}`);

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

		await ingestionQueue.add('initial-import', { ingestionSourceId: source.id });
	}

	/**
	 * Enqueues a reindex of a single ingestion source (and its merge group).
	 * Rebuilds search documents from existing archived rows — never re-ingests.
	 * @param mode 'missing' (default) reindexes only emails not yet in the index;
	 *   'full' rebuilds every document for the source.
	 */
	public static async triggerReindex(id: string, mode: ReindexMode = 'missing'): Promise<void> {
		const source = await this.findById(id);
		if (!source) {
			throw new Error('Ingestion source not found');
		}
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
	}

	/**
	 * Enqueues a reindex of the entire archive across all sources.
	 * @param mode 'missing' (default) or 'full'.
	 */
	public static async triggerReindexAll(mode: ReindexMode = 'missing'): Promise<void> {
		// attempts: 1 — see triggerReindex; the destructive is_indexed reset must not auto-retry.
		await indexingQueue.add('reindex', { scope: 'all', mode }, { attempts: 1 });
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
		const sourceFilter =
			groupIds.length === 1
				? eq(archivedEmails.ingestionSourceId, groupIds[0])
				: inArray(archivedEmails.ingestionSourceId, groupIds);

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

		const emailFilter =
			groupIds.length === 1
				? eq(archivedEmails.ingestionSourceId, groupIds[0])
				: inArray(archivedEmails.ingestionSourceId, groupIds);
		const attachmentFilter =
			groupIds.length === 1
				? eq(attachmentsSchema.ingestionSourceId, groupIds[0])
				: inArray(attachmentsSchema.ingestionSourceId, groupIds);

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
					mailboxCount: countDistinct(archivedEmails.userEmail),
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
					userEmail: archivedEmails.userEmail,
					emailCount: count(),
				})
				.from(archivedEmails)
				.where(emailFilter)
				.groupBy(archivedEmails.userEmail)
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
				.from(
					sql`(select distinct ${archivedEmails.userEmail} as user_email, ${archivedEmails.storageHashSha256} as hash, ${archivedEmails.sizeBytes} as size_bytes from ${archivedEmails} where ${emailFilter}) as t`
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

		await ingestionQueue.add('continuous-sync', { ingestionSourceId: source.id });

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
					await ingestionQueue.add('continuous-sync', { ingestionSourceId: child.id });
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
					const userEmail = user.primaryEmail;
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
							? source.credentials.username
							: 'Default',
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
		messageId: string,
		ingestionSourceId: string,
		userEmail: string
	): Promise<boolean> {
		const groupIds = await this.findGroupSourceIds(ingestionSourceId);
		const sourceFilter =
			groupIds.length === 1
				? eq(archivedEmails.ingestionSourceId, groupIds[0])
				: inArray(archivedEmails.ingestionSourceId, groupIds);

		const existingEmail = await db.query.archivedEmails.findFirst({
			where: and(
				sourceFilter,
				eq(archivedEmails.userEmail, userEmail),
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
	 * sha256 hash; the real Message-ID is still preserved in
	 * archived_emails.message_id_header. Short, safe ids are left as-is so common filenames
	 * stay human-readable.
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

	/** Byte-truncates a string without splitting a multibyte character. */
	private static truncateToBytes(value: string, maxBytes: number): string {
		while (Buffer.byteLength(value) > maxBytes) {
			value = value.slice(0, -1);
		}
		return value;
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
		const truncated = IngestionService.truncateToBytes(
			segment,
			IngestionService.PATH_SEGMENT_MAX_BYTES
		);
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
		return `${IngestionService.truncateToBytes(base, budget)}-${hashSuffix}${ext}`;
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
		userEmail: string,
		skipTempFileCleanup: boolean = false
	): Promise<PendingEmail | ProcessEmailError | null> {
		try {
			// Read the raw bytes from the temp file written by the connector
			const rawEmlBuffer = await readFile(email.tempFilePath);

			// If this source is a child in a merge group, redirect all storage and DB
			// ownership to the root source. Child sources are "assistants" — they fetch
			// emails on behalf of the root but never own any stored content.
			const effectiveSource = source.mergedIntoId
				? await IngestionService.findById(source.mergedIntoId)
				: source;

			// Generate a unique message ID for the email. If the email already has a message-id header, use that.
			// Otherwise, generate a new one based on the email's hash, source ID, and email ID.
			const messageIdHeader = email.headers.get('message-id');
			let messageId: string | undefined;
			if (Array.isArray(messageIdHeader)) {
				messageId = messageIdHeader[0];
			} else if (typeof messageIdHeader === 'string') {
				messageId = messageIdHeader;
			}
			if (!messageId) {
				messageId = `generated-${createHash('sha256')
					.update(rawEmlBuffer)
					.digest('hex')}-${source.id}-${email.id}`;
			}
			// ── Three-gate deduplication ──────────────────────────────────────
			// Gate 1: Per-mailbox idempotency — has THIS mailbox already archived
			//         this email? If so, skip entirely (handles re-sync / retry).
			// Gate 2: Shared-file reference — does the email exist in ANOTHER
			//         mailbox within the merge group? If so, skip file write and
			//         create a reference row pointing to the existing storagePath.
			// Gate 3: Full new ingestion — first time this email is seen anywhere
			//         in the group. Write file + create row.
			// ─────────────────────────────────────────────────────────────────

			const groupIds = await IngestionService.findGroupSourceIds(source.id);
			const groupSourceFilter =
				groupIds.length === 1
					? eq(archivedEmails.ingestionSourceId, groupIds[0])
					: inArray(archivedEmails.ingestionSourceId, groupIds);

			// Gate 1: Per-mailbox duplicate check (idempotency guard for re-sync)
			const perMailboxDuplicate = await db.query.archivedEmails.findFirst({
				where: and(
					eq(archivedEmails.messageIdHeader, messageId),
					eq(archivedEmails.userEmail, userEmail),
					groupSourceFilter
				),
				columns: { id: true },
			});

			if (perMailboxDuplicate) {
				logger.info(
					{ messageId, userEmail, ingestionSourceId: source.id },
					'Skipping duplicate email (same mailbox already has this email)'
				);
				return null;
			}

			// Gate 2: Check if any OTHER mailbox in the group already has this email.
			// If so, we skip the file write and create a reference row that shares
			// the existing storagePath and storageHashSha256.
			const existingGroupEmail = await db.query.archivedEmails.findFirst({
				where: and(eq(archivedEmails.messageIdHeader, messageId), groupSourceFilter),
				// Only the fields needed to build the shared-file reference row below —
				// avoid fetching the entire wide row on every group dedup check.
				columns: {
					id: true,
					storagePath: true,
					storageHashSha256: true,
					sizeBytes: true,
					hasAttachments: true,
				},
			});

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
						providerMessageId: email.id,
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

					for (const link of existingLinks) {
						await db
							.insert(emailAttachments)
							.values({
								emailId: referenceRow.id,
								attachmentId: link.attachmentId,
							})
							.onConflictDoNothing();
					}
				}

				logger.info(
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
						eq(archivedEmails.userEmail, userEmail),
						eq(archivedEmails.ingestionSourceId, effectiveSource.id)
					),
					columns: { id: true },
				});

				if (hashDuplicate) {
					logger.info(
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
						providerMessageId: email.id,
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
					providerMessageId: email.id,
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
				for (const attachment of email.attachments) {
					const attachmentBuffer = attachment.content;
					const attachmentHash = createHash('sha256')
						.update(attachmentBuffer)
						.digest('hex');

					// Check if an attachment with the same hash already exists for the root source
					const existingAttachment = await db.query.attachments.findFirst({
						where: and(
							eq(attachmentsSchema.contentHashSha256, attachmentHash),
							eq(attachmentsSchema.ingestionSourceId, effectiveSource.id)
						),
					});

					let attachmentId: string;

					if (existingAttachment) {
						attachmentId = existingAttachment.id;
						logger.info(
							{
								attachmentHash,
								ingestionSourceId: effectiveSource.id,
								reusedPath: existingAttachment.storagePath,
							},
							'Reusing existing attachment file for deduplication.'
						);
					} else {
						// New attachment: store under the root source's folder.
						// Path uses the source ID only — not the name — so that renaming
						// a source never causes a path mismatch.
						const uniqueId = randomUUID().slice(0, 7);
						const storagePath = `${config.storage.openArchiverFolderName}/${effectiveSource.id}/attachments/${uniqueId}-${this.buildAttachmentFileName(attachment.filename)}`;
						await storage.put(storagePath, attachmentBuffer);

						const [newRecord] = await db
							.insert(attachmentsSchema)
							.values({
								filename: attachment.filename,
								mimeType: attachment.contentType,
								sizeBytes: attachment.size,
								contentHashSha256: attachmentHash,
								storagePath,
								// Always assign attachment ownership to root (effectiveSource)
								ingestionSourceId: effectiveSource.id,
							})
							.returning();
						attachmentId = newRecord.id;
					}

					// Link the attachment record (either new or existing) to the email
					await db
						.insert(emailAttachments)
						.values({
							emailId: archivedEmail.id,
							attachmentId,
						})
						.onConflictDoNothing();
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
