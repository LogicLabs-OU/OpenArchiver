import {
	Attachment,
	EmailAddress,
	EmailDocument,
	EmailObject,
	PendingEmail,
} from '@open-archiver/types';
import { SearchService } from './SearchService';
import { StorageService } from './StorageService';
import { extractText } from '../helpers/textExtractor';
import { DatabaseService } from './DatabaseService';
import { archivedEmails, attachments, emailAttachments } from '../database/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { streamToBuffer } from '../helpers/streamToBuffer';
import { simpleParser, type Attachment as ParsedAttachment } from 'mailparser';
import { logger } from '../config/logger';

interface DbRecipients {
	to: { name: string; address: string }[];
	cc: { name: string; address: string }[];
	bcc: { name: string; address: string }[];
}

type AttachmentsType = {
	filename: string;
	buffer: Buffer;
	mimeType: string;
}[];

/**
 * Sanitizes text content by removing invalid characters that could cause JSON serialization issues
 */
function sanitizeText(text: string): string {
	if (!text) return '';

	// Remove control characters and invalid UTF-8 sequences
	return text
		.replace(/\uFFFD/g, '') // Replacement character for invalid UTF-8 sequences
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
		.trim();
}

/**
 * Recursively sanitize all string values in an object to prevent JSON issues
 */
function sanitizeObject<T>(obj: T): T {
	if (typeof obj === 'string') {
		return sanitizeText(obj) as unknown as T;
	} else if (Array.isArray(obj)) {
		return obj.map(sanitizeObject) as unknown as T;
	} else if (obj !== null && typeof obj === 'object') {
		const sanitized: any = {};
		for (const key in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, key)) {
				sanitized[key] = sanitizeObject((obj as any)[key]);
			}
		}
		return sanitized;
	}
	return obj;
}

export class IndexingService {
	private dbService: DatabaseService;
	private searchService: SearchService;
	private storageService: StorageService;

	constructor(
		dbService: DatabaseService,
		searchService: SearchService,
		storageService: StorageService
	) {
		this.dbService = dbService;
		this.searchService = searchService;
		this.storageService = storageService;
	}

	/**
	 * Index multiple emails in a single batch operation for better performance
	 */
	public async indexEmailBatch(emails: PendingEmail[]): Promise<void> {
		if (emails.length === 0) {
			return;
		}

		logger.info({ batchSize: emails.length }, 'Starting batch indexing of emails');

		const CONCURRENCY_LIMIT = 10;
		const rawDocuments: EmailDocument[] = [];
		// Emails whose document could not be BUILT (corrupt EML, parse error, etc.).
		// These are email-specific ("poison") failures — increment index_attempts so
		// the reconcile job eventually stops retrying them. They are NOT thrown, so the
		// rest of the batch still indexes.
		const buildFailedIds: string[] = [];

		for (let i = 0; i < emails.length; i += CONCURRENCY_LIMIT) {
			const batch = emails.slice(i, i + CONCURRENCY_LIMIT);

			const batchResults = await Promise.allSettled(
				batch.map(async (pendingEmail) => {
					const document = await this.indexEmailById(pendingEmail.archivedEmailId);
					return { id: pendingEmail.archivedEmailId, document };
				})
			);

			for (let j = 0; j < batchResults.length; j++) {
				const result = batchResults[j];
				const pendingEmail = batch[j];
				if (result.status === 'fulfilled' && result.value.document) {
					rawDocuments.push(result.value.document);
				} else {
					buildFailedIds.push(pendingEmail.archivedEmailId);
					if (result.status === 'rejected') {
						logger.error(
							{
								emailId: pendingEmail.archivedEmailId,
								error:
									result.reason instanceof Error
										? result.reason.message
										: String(result.reason),
							},
							'Failed to build document for email in batch'
						);
					}
				}
			}
		}

		if (buildFailedIds.length > 0) {
			await this.incrementIndexAttempts(buildFailedIds);
		}

		if (rawDocuments.length === 0) {
			logger.warn('No documents created from email batch');
			return;
		}

		// Sanitize, fill required fields, and drop anything that cannot be serialized.
		const completeDocuments = rawDocuments
			.map((doc) => sanitizeObject(doc))
			.map((doc) => this.ensureEmailDocumentFields(doc));

		const validDocuments: EmailDocument[] = [];
		const invalidIds: string[] = [];
		for (const doc of completeDocuments) {
			if (this.isValidEmailDocument(doc)) {
				validDocuments.push(doc);
			} else {
				invalidIds.push(doc.id);
				logger.warn({ emailId: doc.id }, 'Skipping invalid EmailDocument');
			}
		}

		if (invalidIds.length > 0) {
			await this.incrementIndexAttempts(invalidIds);
		}

		if (validDocuments.length === 0) {
			logger.warn('No valid documents to index in batch.');
			return;
		}

		logger.debug({ documentCount: validDocuments.length }, 'Sending batch to Meilisearch');

		// Enqueue the write, then WAIT for Meilisearch to actually process the task.
		// Retrying is safe/idempotent because Meilisearch upserts by the `id` primary key.
		const enqueued = await this.searchService.addDocuments('emails', validDocuments, 'id');
		const task = await this.searchService.waitForTask(enqueued.taskUid);

		if (task.status === 'succeeded') {
			// Durably mark these emails as indexed only AFTER Meilisearch confirmed the write.
			await this.markIndexed(validDocuments.map((d) => d.id));
		} else {
			// The batch task failed as a whole — Meilisearch fails a document-addition task
			// atomically, so one bad ("poison") document rejects all 500. Fall back to
			// indexing each document on its own to isolate the offender: the healthy ones
			// still get indexed, and only the genuinely-rejected ids have index_attempts
			// bumped (so the reconcile job eventually stops retrying them instead of the
			// poison wedging its whole keyset page forever).
			logger.warn(
				{ taskUid: enqueued.taskUid, status: task.status, error: task.error ?? {} },
				'Batch indexing task failed; falling back to per-document indexing to isolate poison'
			);
			await this.indexDocumentsIndividually(validDocuments);
		}

		logger.info(
			{
				batchSize: emails.length,
				successfulDocuments: validDocuments.length,
				buildFailed: buildFailedIds.length,
				invalidDocuments: invalidIds.length,
			},
			'Successfully indexed email batch'
		);
	}

	/**
	 * Marks emails as indexed. Chunked to keep the IN(...) list bounded on large batches.
	 */
	private async markIndexed(ids: string[]): Promise<void> {
		const CHUNK = 1000;
		for (let i = 0; i < ids.length; i += CHUNK) {
			const chunk = ids.slice(i, i + CHUNK);
			await this.dbService.db
				.update(archivedEmails)
				.set({ isIndexed: true })
				.where(inArray(archivedEmails.id, chunk));
		}
	}

	/**
	 * Increments the poison-pill counter for emails that failed to index this run.
	 * The reconcile job skips rows whose index_attempts has reached the configured max.
	 */
	private async incrementIndexAttempts(ids: string[]): Promise<void> {
		const CHUNK = 1000;
		for (let i = 0; i < ids.length; i += CHUNK) {
			const chunk = ids.slice(i, i + CHUNK);
			await this.dbService.db
				.update(archivedEmails)
				.set({ indexAttempts: sql`${archivedEmails.indexAttempts} + 1` })
				.where(inArray(archivedEmails.id, chunk));
		}
	}

	/**
	 * Slow fallback used only when a whole-batch Meilisearch task fails: re-add each
	 * document on its own so the poison document is isolated.
	 *
	 * - A per-document task that returns `failed` is a real poison → bump its
	 *   index_attempts (and do NOT throw, so its healthy batch-mates still commit).
	 * - A thrown error (network/timeout) is transient infrastructure trouble → it
	 *   propagates so BullMQ retries the whole batch, and index_attempts is untouched.
	 */
	private async indexDocumentsIndividually(documents: EmailDocument[]): Promise<void> {
		const succeeded: string[] = [];
		const failed: string[] = [];

		for (const doc of documents) {
			const enqueued = await this.searchService.addDocuments('emails', [doc], 'id');
			const task = await this.searchService.waitForTask(enqueued.taskUid);
			if (task.status === 'succeeded') {
				succeeded.push(doc.id);
			} else {
				failed.push(doc.id);
				logger.error(
					{ emailId: doc.id, taskUid: enqueued.taskUid, error: task.error ?? {} },
					'Document rejected by Meilisearch; bumping index_attempts (poison)'
				);
			}
		}

		if (succeeded.length > 0) {
			await this.markIndexed(succeeded);
		}
		if (failed.length > 0) {
			await this.incrementIndexAttempts(failed);
		}
	}

	private async indexEmailById(emailId: string): Promise<EmailDocument | null> {
		const email = await this.dbService.db.query.archivedEmails.findFirst({
			where: eq(archivedEmails.id, emailId),
		});

		if (!email) {
			throw new Error(`Email with ID ${emailId} not found for indexing.`);
		}

		let emailAttachmentsResult: Attachment[] = [];
		if (email.hasAttachments) {
			emailAttachmentsResult = await this.dbService.db
				.select({
					id: attachments.id,
					filename: attachments.filename,
					mimeType: attachments.mimeType,
					sizeBytes: attachments.sizeBytes,
					contentHashSha256: attachments.contentHashSha256,
					storagePath: attachments.storagePath,
				})
				.from(emailAttachments)
				.innerJoin(attachments, eq(emailAttachments.attachmentId, attachments.id))
				.where(eq(emailAttachments.emailId, emailId));
		}

		const document = await this.createEmailDocument(
			email,
			emailAttachmentsResult,
			email.userEmail
		);
		return document;
	}

	/**
	 * @deprecated
	 */
	/* 	private async indexByEmail(pendingEmail: PendingEmail): Promise<void> {
		const attachments: AttachmentsType = [];
		if (pendingEmail.email.attachments && pendingEmail.email.attachments.length > 0) {
			for (const attachment of pendingEmail.email.attachments) {
				attachments.push({
					buffer: attachment.content,
					filename: attachment.filename,
					mimeType: attachment.contentType,
				});
			}
		}
		const document = await this.createEmailDocumentFromRaw(
			pendingEmail.email,
			attachments,
			pendingEmail.sourceId,
			pendingEmail.archivedId,
			pendingEmail.email.userEmail || ''
		);
		// console.log(document);
		await this.searchService.addDocuments('emails', [document], 'id');
	} */

	/**
	 * Creates a search document from a raw email object and its attachments.
	 */
	/* private async createEmailDocumentFromRawForBatch(
		email: EmailObject,
		ingestionSourceId: string,
		archivedEmailId: string,
		userEmail: string
	): Promise<EmailDocument> {
		const extractedAttachments: { filename: string; content: string }[] = [];

		if (email.attachments && email.attachments.length > 0) {
			const ATTACHMENT_CONCURRENCY = 3;

			for (let i = 0; i < email.attachments.length; i += ATTACHMENT_CONCURRENCY) {
				const attachmentBatch = email.attachments.slice(i, i + ATTACHMENT_CONCURRENCY);

				const attachmentResults = await Promise.allSettled(
					attachmentBatch.map(async (attachment) => {
						try {
							if (!this.shouldExtractText(attachment.contentType)) {
								return null;
							}

							const textContent = await extractText(
								attachment.content,
								attachment.contentType || ''
							);

							return {
								filename: attachment.filename,
								content: textContent || '',
							};
						} catch (error) {
							logger.warn(
								{
									filename: attachment.filename,
									mimeType: attachment.contentType,
									emailId: archivedEmailId,
									error: error instanceof Error ? error.message : String(error),
								},
								'Failed to extract text from attachment'
							);
							return null;
						}
					})
				);

				for (const result of attachmentResults) {
					if (result.status === 'fulfilled' && result.value) {
						extractedAttachments.push(result.value);
					}
				}
			}
		}

		const allAttachmentText = extractedAttachments
			.map((att) => sanitizeText(att.content))
			.join(' ');

		const enhancedBody = [sanitizeText(email.body || email.html || ''), allAttachmentText]
			.filter(Boolean)
			.join('\n\n--- Attachments ---\n\n');

		return {
			id: archivedEmailId,
			userEmail: userEmail,
			from: email.from[0]?.address || '',
			to: email.to?.map((addr: EmailAddress) => addr.address) || [],
			cc: email.cc?.map((addr: EmailAddress) => addr.address) || [],
			bcc: email.bcc?.map((addr: EmailAddress) => addr.address) || [],
			subject: email.subject || '',
			body: enhancedBody,
			attachments: extractedAttachments,
			timestamp: new Date(email.receivedAt).getTime(),
			ingestionSourceId: ingestionSourceId,
		};
	} */

	private async createEmailDocumentFromRaw(
		email: EmailObject,
		attachments: AttachmentsType,
		ingestionSourceId: string,
		archivedEmailId: string,
		userEmail: string //the owner of the email inbox
	): Promise<EmailDocument> {
		const extractedAttachments = [];
		for (const attachment of attachments) {
			try {
				const textContent = await extractText(attachment.buffer, attachment.mimeType || '');
				extractedAttachments.push({
					filename: attachment.filename,
					content: textContent,
				});
			} catch (error) {
				logger.error(
					{
						filename: attachment.filename,
						mimeType: attachment.mimeType,
						error: error instanceof Error ? error.message : String(error),
					},
					'Failed to extract text from attachment'
				);
			}
		}
		// console.log('email.userEmail', userEmail);
		return {
			id: archivedEmailId,
			userEmail: userEmail,
			from: email.from[0]?.address,
			fromName: email.from[0]?.name ?? '',
			to: email.to.map((i: EmailAddress) => i.address) || [],
			cc: email.cc?.map((i: EmailAddress) => i.address) || [],
			bcc: email.bcc?.map((i: EmailAddress) => i.address) || [],
			subject: email.subject || '',
			body: email.body || email.html || '',
			attachments: extractedAttachments,
			timestamp: new Date(email.receivedAt).getTime(),
			ingestionSourceId: ingestionSourceId,
		};
	}

	private async createEmailDocument(
		email: typeof archivedEmails.$inferSelect,
		attachments: Attachment[],
		userEmail: string //the owner of the email inbox
	): Promise<EmailDocument> {
		const emailBodyStream = await this.storageService.get(email.storagePath);
		const emailBodyBuffer = await streamToBuffer(emailBodyStream);
		const parsedEmail = await simpleParser(emailBodyBuffer);
		const emailBodyText =
			parsedEmail.text ||
			parsedEmail.html ||
			(await extractText(emailBodyBuffer, 'text/plain')) ||
			'';

		// If there are linked attachment records, extract text from storage (default mode).
		// Otherwise, if the email has attachments but no records (preserve original file mode),
		// extract attachment text directly from the parsed EML body.
		let attachmentContents: { filename: string; content: string }[];
		if (attachments.length > 0) {
			attachmentContents = await this.extractAttachmentContents(attachments);
		} else if (email.hasAttachments && parsedEmail.attachments.length > 0) {
			attachmentContents = await this.extractInlineAttachmentContents(
				parsedEmail.attachments
			);
		} else {
			attachmentContents = [];
		}

		const recipients = email.recipients as DbRecipients;
		// console.log('email.userEmail', email.userEmail);
		return {
			id: email.id,
			userEmail: userEmail,
			from: email.senderEmail,
			fromName: email.senderName ?? '',
			to: recipients.to?.map((r) => r.address) || [],
			cc: recipients.cc?.map((r) => r.address) || [],
			bcc: recipients.bcc?.map((r) => r.address) || [],
			subject: email.subject || '',
			body: emailBodyText,
			attachments: attachmentContents,
			timestamp: new Date(email.sentAt).getTime(),
			ingestionSourceId: email.ingestionSourceId,
		};
	}

	/**
	 * Extracts text content from attachments embedded in the parsed EML.
	 * Used in preserve-original-file (GoBD) mode where no separate attachment
	 * records exist — the full MIME body is stored unmodified, so we parse
	 * attachments directly from the in-memory parsed email.
	 */
	private async extractInlineAttachmentContents(
		parsedAttachments: ParsedAttachment[]
	): Promise<{ filename: string; content: string }[]> {
		const extracted: { filename: string; content: string }[] = [];
		for (const attachment of parsedAttachments) {
			try {
				const textContent = await extractText(
					attachment.content,
					attachment.contentType || ''
				);
				extracted.push({
					filename: attachment.filename || 'untitled',
					content: textContent,
				});
			} catch (error) {
				logger.warn(
					{
						filename: attachment.filename,
						mimeType: attachment.contentType,
						error: error instanceof Error ? error.message : String(error),
					},
					'Failed to extract text from inline attachment in preserve-original mode'
				);
			}
		}
		return extracted;
	}

	private async extractAttachmentContents(
		attachments: Attachment[]
	): Promise<{ filename: string; content: string }[]> {
		const extractedAttachments = [];
		for (const attachment of attachments) {
			try {
				const fileStream = await this.storageService.get(attachment.storagePath);
				const fileBuffer = await streamToBuffer(fileStream);
				const textContent = await extractText(fileBuffer, attachment.mimeType || '');
				extractedAttachments.push({
					filename: attachment.filename,
					content: textContent,
				});
			} catch (error) {
				console.error(
					`Failed to extract text from attachment: ${attachment.filename}`,
					error
				);
			}
		}
		return extractedAttachments;
	}

	private shouldExtractText(mimeType: string): boolean {
		if (process.env.TIKA_URL) {
			return true;
		}

		if (!mimeType) return false;
		// Tika supported mime types: https://tika.apache.org/2.4.1/formats.html
		const extractableTypes = [
			'application/pdf',
			'application/msword',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'application/vnd.ms-excel',
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'application/vnd.ms-powerpoint',
			'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			'text/plain',
			'text/html',
			'application/rss+xml',
			'application/xml',
			'application/json',
			'text/rtf',
			'application/rtf',
			'text/csv',
			'text/tsv',
			'application/csv',
			'image/bpg',
			'image/png',
			'image/vnd.wap.wbmp',
			'image/x-jbig2',
			'image/bmp',
			'image/x-xcf',
			'image/gif',
			'image/x-icon',
			'image/jpeg',
			'image/x-ms-bmp',
			'image/webp',
			'image/tiff',
			'image/svg+xml',
			'application/vnd.apple.pages',
			'application/vnd.apple.numbers',
			'application/vnd.apple.keynote',
			'image/heic',
			'image/heif',
		];

		return extractableTypes.some((type) => mimeType.toLowerCase().includes(type));
	}

	/**
	 * Ensures all required fields are present in EmailDocument
	 */
	private ensureEmailDocumentFields(doc: Partial<EmailDocument>): EmailDocument {
		return {
			id: doc.id || 'missing-id',
			userEmail: doc.userEmail || 'unknown',
			from: doc.from || '',
			fromName: doc.fromName || '',
			to: Array.isArray(doc.to) ? doc.to : [],
			cc: Array.isArray(doc.cc) ? doc.cc : [],
			bcc: Array.isArray(doc.bcc) ? doc.bcc : [],
			subject: doc.subject || '',
			body: doc.body || '',
			attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
			timestamp: typeof doc.timestamp === 'number' ? doc.timestamp : Date.now(),
			ingestionSourceId: doc.ingestionSourceId || 'unknown',
		};
	}

	/**
	 * Validates if the given object is a valid EmailDocument that can be serialized to JSON
	 */
	private isValidEmailDocument(doc: any): boolean {
		try {
			JSON.stringify(doc);
			return true;
		} catch (error) {
			logger.error(
				{ doc, error: (error as Error).message },
				'Invalid EmailDocument detected'
			);
			return false;
		}
	}
}
