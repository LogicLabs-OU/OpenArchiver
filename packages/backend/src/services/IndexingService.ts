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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { streamToBuffer } from '../helpers/streamToBuffer';
import { truncateToBytes } from '../helpers/truncateToBytes';
import { mapWithConcurrency } from '../helpers/mapWithConcurrency';
import { simpleParser, type Attachment as ParsedAttachment } from 'mailparser';
import { logger } from '../config/logger';
import { config } from '../config';
import { MeiliSearchApiError } from 'meilisearch';

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
 * Whether Meilisearch refused the request because of what was sent, rather than because the engine
 * was unreachable or busy.
 *
 * Only `MeiliSearchApiError` carries an HTTP response — a connection failure raises
 * `MeiliSearchRequestError` and a slow task raises `MeiliSearchTaskTimeOutError`, neither of which
 * has one. A 4xx means retrying the identical payload will fail identically (413 for an oversized
 * chunk, 400 for a malformed document), so it is the document's fault and counts. A 5xx is the
 * engine's, and does not.
 */
function isDocumentRejection(error: unknown): boolean {
	if (!(error instanceof MeiliSearchApiError)) {
		return false;
	}
	const status = error.response?.status;
	return typeof status === 'number' && status >= 400 && status < 500;
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
	 * Indexes a batch of archived emails.
	 *
	 * Documents are built and shipped in chunks rather than all at once. That is what bounds the
	 * worker's memory: building a document reads the whole .eml into a Buffer, parses it, and
	 * extracts attachment text, so holding a full batch of them at once is what exhausted the heap
	 * in production ("Ineffective mark-compacts near heap limit" after eight 500-email jobs). Peak
	 * usage now follows `indexingChunkSize`, not how many ids the job happens to carry.
	 *
	 * Marking is per chunk too, so a crash part-way through keeps the progress already confirmed by
	 * Meilisearch instead of discarding the whole job's work.
	 */
	public async indexEmailBatch(emails: PendingEmail[]): Promise<void> {
		if (emails.length === 0) {
			return;
		}

		logger.info({ batchSize: emails.length }, 'Starting batch indexing of emails');

		const chunkSize = Math.max(1, config.meili.indexingChunkSize);
		// Building is I/O-bound (storage read, parse, text extraction) and independent of how many
		// documents travel to Meilisearch together, so it keeps its own cap instead of inheriting the
		// payload size. Tying the two meant raising the chunk to reduce round trips also raised how
		// many .eml buffers were resident at once — the opposite of what the chunk exists to control.
		//
		// Divided by the worker's job concurrency so the PROCESS-wide figure stays near ten however
		// many jobs run at once. Without the division, raising the worker to four jobs quietly
		// multiplied resident raw buffers fourfold against an unchanged heap ceiling — reintroducing
		// the out-of-memory crash the chunking was added to fix.
		const buildConcurrency = Math.min(
			Math.max(1, Math.floor(10 / config.indexing.workerConcurrency)),
			chunkSize
		);

		const pending = await this.skipAlreadyIndexed(emails);
		let buildFailed = 0;
		let invalid = 0;
		let indexed = 0;

		// One flush is allowed to be in flight while the NEXT chunk builds. Building is storage reads
		// and parsing; flushing is a Meilisearch round trip the flush must see finish before it may
		// mark anything indexed. Run strictly in sequence, each chunk paid for both in full. Held to
		// exactly one outstanding flush, and collected as soon as the next chunk's build finishes —
		// before that chunk writes anything — so markIndexed ordering, error propagation and the
		// retry path match the serial version, and no more than two chunks are ever resident.
		let pendingFlush: Promise<{ indexed: number; invalid: number }> | null = null;
		const collectFlush = async (): Promise<void> => {
			if (!pendingFlush) {
				return;
			}
			const settled = pendingFlush;
			// Cleared BEFORE awaiting, so the final collect after the loop cannot await the same
			// flush a second time and double-count it.
			pendingFlush = null;
			const result = await settled;
			indexed += result.indexed;
			invalid += result.invalid;
		};

		for (let i = 0; i < pending.length; i += chunkSize) {
			const chunk = pending.slice(i, i + chunkSize);

			const results = await mapWithConcurrency(chunk, buildConcurrency, (pendingEmail) =>
				this.indexEmailById(pendingEmail.archivedEmailId)
			);

			// The previous chunk's Meilisearch task has had this chunk's whole build to settle, and
			// is collected HERE — before this chunk commits anything. Collected after, a failed
			// flush still let the next chunk's index_attempts bumps land first, so every BullMQ
			// retry of an outage double-counted borderline rows and dropped them from search after
			// about half the intended failures.
			await collectFlush();

			// Emails whose document could not be BUILT (corrupt EML, parse error, missing file).
			// These are email-specific ("poison") failures: count them against index_attempts so
			// the reconcile job eventually stops retrying them, and do not throw, so their
			// chunk-mates still index.
			const buildFailedIds: string[] = [];
			const documents: EmailDocument[] = [];

			for (let j = 0; j < results.length; j++) {
				const result = results[j];
				const emailId = chunk[j].archivedEmailId;

				if (result.status === 'fulfilled' && result.value) {
					// One pass: sanitize and fill required fields together. Doing them as two
					// chained .map() calls rebuilt every object and every string twice over.
					documents.push(this.normalizeEmailDocument(result.value));
				} else {
					buildFailedIds.push(emailId);
					if (result.status === 'rejected') {
						logger.error(
							{
								emailId,
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

			if (buildFailedIds.length > 0) {
				buildFailed += buildFailedIds.length;
				await this.incrementIndexAttempts(buildFailedIds);
			}

			if (documents.length === 0) {
				continue;
			}

			pendingFlush = this.flushDocuments(documents);
			// Marked handled the instant it starts. A flush that fails while the next chunk is
			// still building would otherwise sit rejected-and-unobserved for the length of that
			// build, which Node reports as an unhandled rejection and the worker's process-level
			// handler logs as an unexplained failure — for something this loop goes on to observe
			// properly at the next collectFlush. Attaching a handler does not swallow it: `.catch`
			// returns a new promise and leaves this one rejected, so the await still throws.
			pendingFlush.catch(() => undefined);
		}

		await collectFlush();

		// One neutral line with the counters, rather than a cheerful "Successfully indexed" that also
		// printed when every document in the batch failed to build.
		logger.info(
			{
				batchSize: emails.length,
				alreadyIndexed: emails.length - pending.length,
				successfulDocuments: indexed,
				buildFailed,
				invalidDocuments: invalid,
			},
			'Finished indexing email batch'
		);
	}

	/**
	 * Drops ids already marked indexed.
	 *
	 * BullMQ retries a failed job with its original payload, so a chunk that died part-way through
	 * came back with every id — including those Meilisearch had already confirmed and `markIndexed`
	 * had committed. Rebuilding those means re-reading and re-parsing each .eml for nothing. Safe to
	 * skip: the reindex processor clears `is_indexed` before enqueueing, so a set flag inside a live
	 * job can only mean this run already did the work.
	 */
	private async skipAlreadyIndexed(emails: PendingEmail[]): Promise<PendingEmail[]> {
		if (emails.length === 0) {
			return emails;
		}

		const ids = emails.map((e) => e.archivedEmailId);
		const done = await this.dbService.db
			.select({ id: archivedEmails.id })
			.from(archivedEmails)
			.where(and(inArray(archivedEmails.id, ids), eq(archivedEmails.isIndexed, true)));

		if (done.length === 0) {
			return emails;
		}

		const doneIds = new Set(done.map((r) => r.id));
		return emails.filter((e) => !doneIds.has(e.archivedEmailId));
	}

	/**
	 * Sends one chunk of built documents to Meilisearch and records the outcome.
	 *
	 * The counter this feeds, `index_attempts`, is what lets the reconcile scan give up on a row and
	 * move its keyset cursor forward. Getting the accounting wrong breaks the archive in one of two
	 * ways, and this method has to thread between them:
	 *
	 * - Count nothing on a throw, and a row that always fails stays at zero attempts forever. The
	 *   reconcile scan restarts at the front every tick, re-enqueues it, and never advances. Both
	 *   production and dev showed exactly that signature: every unindexed row at zero attempts.
	 * - Count everything on a throw, and a thirty-second Meilisearch restart is fatal. One job burns
	 *   its five BullMQ attempts in ~15s of exponential backoff, so the whole chunk reaches the
	 *   exclusion threshold and silently leaves the archive's search index for good.
	 *
	 * So the error decides. A deterministic rejection (4xx: the document is wrong) goes to
	 * per-document isolation, which counts only the ids Meilisearch actually refuses — a single
	 * oversized attachment must not drag its chunk-mates out of the index with it. Anything else is
	 * treated as infrastructure trouble and rethrown untouched, for BullMQ to retry.
	 */
	private async flushDocuments(
		documents: EmailDocument[]
	): Promise<{ indexed: number; invalid: number }> {
		const validDocuments: EmailDocument[] = [];
		const invalidIds: string[] = [];

		for (const doc of documents) {
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
			return { indexed: 0, invalid: invalidIds.length };
		}

		logger.debug({ documentCount: validDocuments.length }, 'Sending chunk to Meilisearch');

		try {
			// Enqueue the write, then WAIT for Meilisearch to actually process the task.
			// Retrying is safe/idempotent because Meilisearch upserts by the `id` primary key.
			const enqueued = await this.searchService.addDocuments('emails', validDocuments, 'id');
			const task = await this.searchService.waitForTask(enqueued.taskUid);

			if (task.status === 'succeeded') {
				// Durably mark these emails as indexed only AFTER Meilisearch confirmed the write.
				await this.markIndexed(validDocuments.map((d) => d.id));
				return { indexed: validDocuments.length, invalid: invalidIds.length };
			}

			// The chunk task failed as a whole — Meilisearch fails a document-addition task
			// atomically, so one bad ("poison") document rejects all of them. Fall back to indexing
			// each document on its own to isolate the offender: the healthy ones still get indexed,
			// and only the genuinely-rejected ids have index_attempts bumped.
			logger.warn(
				{ taskUid: enqueued.taskUid, status: task.status, error: task.error ?? {} },
				'Chunk indexing task failed; falling back to per-document indexing to isolate poison'
			);
			const isolated = await this.indexDocumentsIndividually(validDocuments);
			return { indexed: isolated, invalid: invalidIds.length };
		} catch (error) {
			if (!isDocumentRejection(error)) {
				// Connection refused, timed out, 5xx: the documents are probably fine and the engine
				// is not. Rethrow without counting, so BullMQ retries and the reconcile pass keeps
				// ownership of these rows.
				throw error;
			}

			// Meilisearch refused the request itself rather than failing the task (a 413 on an
			// oversized payload, a malformed document). Deterministic, so retrying the chunk whole
			// achieves nothing — isolate instead, which indexes the healthy documents and counts
			// only the ids actually refused.
			logger.warn(
				{ error: error instanceof Error ? error.message : String(error) },
				'Meilisearch rejected the chunk; isolating per document'
			);
			const isolated = await this.indexDocumentsIndividually(validDocuments);
			return { indexed: isolated, invalid: invalidIds.length };
		}
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
	 * Slow fallback used when a whole chunk is refused: re-add each document on its own so the
	 * offending one is isolated.
	 *
	 * - A per-document task that returns `failed` is a real poison → bump its index_attempts, and do
	 *   NOT throw, so its healthy chunk-mates still commit.
	 * - A thrown error is infrastructure trouble → it propagates to flushDocuments, which decides
	 *   whether it counts. The bookkeeping below runs in a `finally` so a throw half-way through the
	 *   loop still commits the documents already confirmed; without that, a Meilisearch restart
	 *   mid-isolation discarded every success that preceded it and the whole chunk was rebuilt.
	 *
	 * @returns how many documents Meilisearch accepted.
	 */
	private async indexDocumentsIndividually(documents: EmailDocument[]): Promise<number> {
		const succeeded: string[] = [];
		const failed: string[] = [];

		try {
			for (const doc of documents) {
				try {
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
				} catch (error) {
					if (!isDocumentRejection(error)) {
						throw error;
					}
					// Refused on its own, deterministically — an oversized document comes back as a
					// 413 from the HTTP layer rather than as a failed task, so it never reaches the
					// branch above. Counting it here is what lets the reconcile scan eventually pass
					// over it; letting it propagate would leave it at zero attempts forever, which is
					// the exact loop this whole mechanism exists to break.
					failed.push(doc.id);
					logger.error(
						{
							emailId: doc.id,
							error: error instanceof Error ? error.message : String(error),
						},
						'Document refused by Meilisearch; bumping index_attempts (poison)'
					);
				}
			}
		} finally {
			if (succeeded.length > 0) {
				await this.markIndexed(succeeded);
			}
			if (failed.length > 0) {
				await this.incrementIndexAttempts(failed);
			}
		}

		return succeeded.length;
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
	 * Note: two commented-out `@deprecated` helpers and an unreferenced `createEmailDocumentFromRaw`
	 * used to sit here. They were removed rather than maintained — a code review read the call
	 * inside the commented block as live and reported a missing text cap on a path nothing can
	 * reach. Dead code that still looks reachable costs more than it saves.
	 */

	private async createEmailDocument(
		email: typeof archivedEmails.$inferSelect,
		attachments: Attachment[],
		userEmail: string //the owner of the email inbox
	): Promise<EmailDocument> {
		const emailBodyStream = await this.storageService.get(email.storagePath);
		const emailBodyBuffer = await streamToBuffer(emailBodyStream);
		const parsedEmail = await simpleParser(emailBodyBuffer);
		// Capped here rather than only at normalization so the oversized string is released now,
		// instead of being retained for as long as the chunk is in flight.
		const emailBodyText = truncateToBytes(
			parsedEmail.text ||
				parsedEmail.html ||
				(await extractText(emailBodyBuffer, 'text/plain')) ||
				'',
			config.indexing.maxTextBytes
		);

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
			hasAttachments: !!email.hasAttachments,
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
		const results = await mapWithConcurrency(
			parsedAttachments,
			IndexingService.ATTACHMENT_READ_CONCURRENCY,
			async (attachment) => ({
				filename: attachment.filename || 'untitled',
				content: truncateToBytes(
					await extractText(attachment.content, attachment.contentType || ''),
					config.indexing.maxTextBytes
				),
			})
		);

		const extracted: { filename: string; content: string }[] = [];
		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result.status === 'fulfilled') {
				extracted.push(result.value);
			} else {
				logger.warn(
					{
						err: result.reason,
						filename: parsedAttachments[i].filename,
						mimeType: parsedAttachments[i].contentType,
					},
					'Failed to extract text from inline attachment in preserve-original mode'
				);
			}
		}
		return extracted;
	}

	/**
	 * Reads each attachment back out of storage and extracts its text.
	 *
	 * Bounded rather than sequential: every attachment costs a storage GET (a network round trip on
	 * S3, plus an AES decrypt) before any parsing starts, and one email's attachments have no reason
	 * to queue behind each other for that. The bound is deliberately small — extraction itself is
	 * CPU-bound and largely synchronous, so a wide pool would only pile work onto one event loop,
	 * and this already runs inside the per-email build pool.
	 */
	private static readonly ATTACHMENT_READ_CONCURRENCY = 3;

	private async extractAttachmentContents(
		attachments: Attachment[]
	): Promise<{ filename: string; content: string }[]> {
		const results = await mapWithConcurrency(
			attachments,
			IndexingService.ATTACHMENT_READ_CONCURRENCY,
			async (attachment) => {
				const fileStream = await this.storageService.get(attachment.storagePath);
				const fileBuffer = await streamToBuffer(fileStream);
				const textContent = await extractText(fileBuffer, attachment.mimeType || '');
				return {
					filename: attachment.filename,
					content: truncateToBytes(textContent, config.indexing.maxTextBytes),
				};
			}
		);

		const extractedAttachments: { filename: string; content: string }[] = [];
		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result.status === 'fulfilled') {
				extractedAttachments.push(result.value);
			} else {
				// One unreadable attachment must not cost the email its body text, so this is warn
				// and continue, as before — via the logger, so it lands in the same structured
				// stream as everything else rather than raw on stdout.
				logger.warn(
					{ err: result.reason, filename: attachments[i].filename },
					'Failed to extract text from attachment'
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
	 * Sanitizes every string and fills the required fields in one pass.
	 *
	 * This used to be a generic recursive `sanitizeObject` followed by a separate fill, chained as
	 * two `.map()` calls over the whole batch — so every document and every string in it was rebuilt
	 * twice before anything was sent. The shape of an EmailDocument is known, so walking it directly
	 * costs one copy instead of three.
	 */
	private normalizeEmailDocument(doc: Partial<EmailDocument>): EmailDocument {
		const maxTextBytes = config.indexing.maxTextBytes;
		// Filtered, not coerced. `String(undefined)` produced the literal "undefined", which then went
		// into the index as a real, searchable, facetable recipient address.
		const addresses = (value: unknown): string[] =>
			Array.isArray(value)
				? value.filter((a): a is string => typeof a === 'string').map(sanitizeText)
				: [];

		return {
			id: doc.id || 'missing-id',
			userEmail: sanitizeText(doc.userEmail || '') || 'unknown',
			from: sanitizeText(doc.from || ''),
			fromName: sanitizeText(doc.fromName || ''),
			to: addresses(doc.to),
			cc: addresses(doc.cc),
			bcc: addresses(doc.bcc),
			subject: sanitizeText(doc.subject || ''),
			body: truncateToBytes(sanitizeText(doc.body || ''), maxTextBytes),
			attachments: Array.isArray(doc.attachments)
				? doc.attachments.map((a) => ({
						filename: sanitizeText(a?.filename || ''),
						content: truncateToBytes(sanitizeText(a?.content || ''), maxTextBytes),
					}))
				: [],
			timestamp: typeof doc.timestamp === 'number' ? doc.timestamp : Date.now(),
			ingestionSourceId: doc.ingestionSourceId || 'unknown',
			hasAttachments: doc.hasAttachments ?? (doc.attachments?.length ?? 0) > 0,
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
