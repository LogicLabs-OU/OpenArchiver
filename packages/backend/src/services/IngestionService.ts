import { db } from '../database';
import { ingestionSources } from '../database/schema';
import type {
	CreateIngestionSourceDto,
	UpdateIngestionSourceDto,
	IngestionSource,
	IngestionCredentials,
	IngestionProvider,
	PendingEmail,
} from '@open-archiver/types';
import { and, desc, eq } from 'drizzle-orm';
import { CryptoService } from './CryptoService';
import { EmailProviderFactory } from './EmailProviderFactory';
import { ingestionQueue } from '../jobs/queues';
import type { JobType } from 'bullmq';
import { StorageService } from './StorageService';
import type { IInitialImportJob, EmailObject } from '@open-archiver/types';
import {
	archivedEmails,
	attachments as attachmentsSchema,
	emailAttachments,
} from '../database/schema';
import { createHash, randomUUID } from 'crypto';
import { logger } from '../config/logger';
import { SearchService } from './SearchService';
import { config } from '../config/index';
import { FilterBuilder } from './FilterBuilder';
import { AuditService } from './AuditService';
import { User } from '@open-archiver/types';
import { checkDeletionEnabled } from '../helpers/deletionGuard';

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
		const { providerConfig, ...rest } = dto;
		const encryptedCredentials = CryptoService.encryptObject(providerConfig);

		const valuesToInsert = {
			userId,
			...rest,
			status: 'pending_auth' as const,
			credentials: encryptedCredentials,
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

		const sources = await query.orderBy(desc(ingestionSources.createdAt));
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

		// Delete all emails and attachments from storage
		const storage = new StorageService();
		const emailPath = `${config.storage.openArchiverFolderName}/${source.name.replaceAll(' ', '-')}-${source.id}/`;
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

	public async processEmail(
		email: EmailObject,
		source: IngestionSource,
		storage: StorageService,
		userEmail: string
	): Promise<PendingEmail | null> {
		try {
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
					.update(email.eml ?? Buffer.from(email.body, 'utf-8'))
					.digest('hex')}-${source.id}-${email.id}`;
			}
			// Check if an email with the same message ID has already been imported for the current ingestion source. This is to prevent duplicate imports when an email is present in multiple mailboxes (e.g., "Inbox" and "All Mail").
			const existingEmail = await db.query.archivedEmails.findFirst({
				where: and(
					eq(archivedEmails.messageIdHeader, messageId),
					eq(archivedEmails.ingestionSourceId, source.id)
				),
			});

			if (existingEmail) {
				logger.info(
					{ messageId, ingestionSourceId: source.id },
					'Skipping duplicate email'
				);
				return null;
			}

			const emlBuffer = email.eml ?? Buffer.from(email.body, 'utf-8');
			const emailHash = createHash('sha256').update(emlBuffer).digest('hex');
			const sanitizedPath = email.path ? email.path : '';
			const emailPath = `${config.storage.openArchiverFolderName}/${source.name.replaceAll(' ', '-')}-${source.id}/emails/${sanitizedPath}${email.id}.eml`;
			await storage.put(emailPath, emlBuffer);

			const [archivedEmail] = await db
				.insert(archivedEmails)
				.values({
					ingestionSourceId: source.id,
					userEmail,
					threadId: email.threadId,
					messageIdHeader: messageId,
					sentAt: email.receivedAt,
					subject: email.subject,
					senderName: email.from[0]?.name,
					senderEmail: email.from[0]?.address,
					recipients: {
						to: email.to,
						cc: email.cc,
						bcc: email.bcc,
					},
					storagePath: emailPath,
					storageHashSha256: emailHash,
					sizeBytes: emlBuffer.length,
					hasAttachments: email.attachments.length > 0,
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

					// Check if an attachment with the same hash already exists for this source
					const existingAttachment = await db.query.attachments.findFirst({
						where: and(
							eq(attachmentsSchema.contentHashSha256, attachmentHash),
							eq(attachmentsSchema.ingestionSourceId, source.id)
						),
					});

					let storagePath: string;

					if (existingAttachment) {
						// If it exists, reuse the storage path and don't save the file again
						storagePath = existingAttachment.storagePath;
						logger.info(
							{
								attachmentHash,
								ingestionSourceId: source.id,
								reusedPath: storagePath,
							},
							'Reusing existing attachment file for deduplication.'
						);
					} else {
						// If it's a new attachment, create a unique path and save it
						const uniqueId = randomUUID().slice(0, 7);
						storagePath = `${config.storage.openArchiverFolderName}/${source.name.replaceAll(' ', '-')}-${source.id}/attachments/${uniqueId}-${attachment.filename}`;
						await storage.put(storagePath, attachmentBuffer);
					}

					let attachmentRecord = existingAttachment;

					if (!attachmentRecord) {
						// If it's a new attachment, create a unique path and save it
						const uniqueId = randomUUID().slice(0, 5);
						const storagePath = `${config.storage.openArchiverFolderName}/${source.name.replaceAll(' ', '-')}-${source.id}/attachments/${uniqueId}-${attachment.filename}`;
						await storage.put(storagePath, attachmentBuffer);

						// Insert a new attachment record
						[attachmentRecord] = await db
							.insert(attachmentsSchema)
							.values({
								filename: attachment.filename,
								mimeType: attachment.contentType,
								sizeBytes: attachment.size,
								contentHashSha256: attachmentHash,
								storagePath: storagePath,
								ingestionSourceId: source.id,
							})
							.returning();
					}

					// Link the attachment record (either new or existing) to the email
					await db
						.insert(emailAttachments)
						.values({
							emailId: archivedEmail.id,
							attachmentId: attachmentRecord.id,
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
			return null;
		}
	}
}
