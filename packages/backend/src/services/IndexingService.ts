import { Attachment, EmailAddress, EmailDocument, EmailObject } from '@open-archiver/types';
import { SearchService } from './SearchService';
import { StorageService } from './StorageService';
import { extractText } from '../helpers/textExtractor';
import { DatabaseService } from './DatabaseService';
import { archivedEmails, attachments, emailAttachments } from '../database/schema';
import { eq } from 'drizzle-orm';
import { streamToBuffer } from '../helpers/streamToBuffer';
import { simpleParser } from 'mailparser';

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

export class IndexingService {
	private dbService: DatabaseService;
	private searchService: SearchService;
	private storageService: StorageService;

	/**
	 * Initializes the service with its dependencies.
	 */
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
	 * Fetches an email by its ID from the database, creates a search document, and indexes it.
	 */
	public async indexEmailById(emailId: string): Promise<void> {
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
		await this.searchService.addDocuments('emails', [document], 'id');
	}

	/**
	 * Indexes an email object directly, creates a search document, and indexes it.
	 */
	public async indexByEmail(
		email: EmailObject,
		ingestionSourceId: string,
		archivedEmailId: string
	): Promise<void> {
		const attachments: AttachmentsType = [];
		if (email.attachments && email.attachments.length > 0) {
			for (const attachment of email.attachments) {
				attachments.push({
					buffer: attachment.content,
					filename: attachment.filename,
					mimeType: attachment.contentType,
				});
			}
		}
		const document = await this.createEmailDocumentFromRaw(
			email,
			attachments,
			ingestionSourceId,
			archivedEmailId,
			email.userEmail || ''
		);
		// console.log(document);
		await this.searchService.addDocuments('emails', [document], 'id');
	}

	/**
	 * Creates a search document from a raw email object and its attachments.
	 */
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
				console.error(
					`Failed to extract text from attachment: ${attachment.filename}`,
					error
				);
				//  skip attachment or fail the job
			}
		}
		// console.log('email.userEmail', userEmail);
		return {
			id: archivedEmailId,
			userEmail: userEmail,
			from: email.from[0]?.address,
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

	/**
	 * Creates a search document from a database email record and its attachments.
	 */
	private async createEmailDocument(
		email: typeof archivedEmails.$inferSelect,
		attachments: Attachment[],
		userEmail: string //the owner of the email inbox
	): Promise<EmailDocument> {
		const attachmentContents = await this.extractAttachmentContents(attachments);

		const emailBodyStream = await this.storageService.get(email.storagePath);
		const emailBodyBuffer = await streamToBuffer(emailBodyStream);
		const parsedEmail = await simpleParser(emailBodyBuffer);
		const emailBodyText =
			parsedEmail.text ||
			parsedEmail.html ||
			(await extractText(emailBodyBuffer, 'text/plain')) ||
			'';

		const recipients = email.recipients as DbRecipients;
		// console.log('email.userEmail', email.userEmail);
		return {
			id: email.id,
			userEmail: userEmail,
			from: email.senderEmail,
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
	 * Extracts text content from a list of attachments.
	 */
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
				//  skip attachment or fail the job
			}
		}
		return extractedAttachments;
	}
}
