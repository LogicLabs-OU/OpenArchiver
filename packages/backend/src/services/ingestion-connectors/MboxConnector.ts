import type {
	MboxImportCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector } from '../EmailProviderFactory';
import { simpleParser, ParsedMail, Attachment, AddressObject } from 'mailparser';
import { logger } from '../../config/logger';
import { getThreadId } from './helpers/utils';
import { StorageService } from '../StorageService';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { streamToBuffer } from '../../helpers/streamToBuffer';

export class MboxConnector implements IEmailConnector {
	private storage: StorageService;

	constructor(private credentials: MboxImportCredentials) {
		this.storage = new StorageService();
	}

	public async testConnection(): Promise<boolean> {
		try {
			if (!this.credentials.uploadedFilePath) {
				throw Error('Mbox file path not provided.');
			}
			if (!this.credentials.uploadedFilePath.includes('.mbox')) {
				throw Error('Provided file is not in the MBOX format.');
			}
			const fileExist = await this.storage.exists(this.credentials.uploadedFilePath);
			if (!fileExist) {
				throw Error('Mbox file upload not finished yet, please wait.');
			}

			return true;
		} catch (error) {
			logger.error({ error, credentials: this.credentials }, 'Mbox file validation failed.');
			throw error;
		}
	}

	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		const displayName =
			this.credentials.uploadedFileName || `mbox-import-${new Date().getTime()}`;
		logger.info(`Found potential mailbox: ${displayName}`);
		const constructedPrimaryEmail = `${displayName.replace(/ /g, '.').toLowerCase()}@mbox.local`;
		yield {
			id: constructedPrimaryEmail,
			primaryEmail: constructedPrimaryEmail,
			displayName: displayName,
		};
	}

	public async *fetchEmails(
		userEmail: string,
		syncState?: SyncState | null
	): AsyncGenerator<EmailObject | null> {
		try {
			const fileStream = await this.storage.get(this.credentials.uploadedFilePath);
			const fileBuffer = await streamToBuffer(fileStream as Readable);
			const mboxContent = fileBuffer.toString('utf-8');
			const emailDelimiter = '\nFrom ';
			const emails = mboxContent.split(emailDelimiter);

			// The first split part might be empty or part of the first email's header, so we adjust.
			if (emails.length > 0 && !mboxContent.startsWith('From ')) {
				emails.shift(); // Adjust if the file doesn't start with "From "
			}

			logger.info(`Found ${emails.length} potential emails in the mbox file.`);
			let emailCount = 0;

			for (const email of emails) {
				try {
					// Re-add the "From " delimiter for the parser, except for the very first email
					const emailWithDelimiter =
						emailCount > 0 || mboxContent.startsWith('From ') ? `From ${email}` : email;
					const emailBuffer = Buffer.from(emailWithDelimiter, 'utf-8');
					const emailObject = await this.parseMessage(emailBuffer, '');
					yield emailObject;
					emailCount++;
				} catch (error) {
					logger.error(
						{ error, file: this.credentials.uploadedFilePath },
						'Failed to process a single message from mbox file. Skipping.'
					);
				}
			}
			logger.info(`Finished processing mbox file. Total emails processed: ${emailCount}`);
		} finally {
			try {
				await this.storage.delete(this.credentials.uploadedFilePath);
			} catch (error) {
				logger.error(
					{ error, file: this.credentials.uploadedFilePath },
					'Failed to delete mbox file after processing.'
				);
			}
		}
	}

	private async parseMessage(emlBuffer: Buffer, path: string): Promise<EmailObject> {
		const parsedEmail: ParsedMail = await simpleParser(emlBuffer);

		const attachments = parsedEmail.attachments.map((attachment: Attachment) => ({
			filename: attachment.filename || 'untitled',
			contentType: attachment.contentType,
			size: attachment.size,
			content: attachment.content as Buffer,
		}));

		const mapAddresses = (
			addresses: AddressObject | AddressObject[] | undefined
		): EmailAddress[] => {
			if (!addresses) return [];
			const addressArray = Array.isArray(addresses) ? addresses : [addresses];
			return addressArray.flatMap((a) =>
				a.value.map((v) => ({
					name: v.name,
					address: v.address?.replaceAll(`'`, '') || '',
				}))
			);
		};

		const threadId = getThreadId(parsedEmail.headers);
		let messageId = parsedEmail.messageId;

		if (!messageId) {
			messageId = `generated-${createHash('sha256').update(emlBuffer).digest('hex')}`;
		}

		const from = mapAddresses(parsedEmail.from);
		if (from.length === 0) {
			from.push({ name: 'No Sender', address: 'No Sender' });
		}

		// Extract folder path from headers. Mbox files don't have a standard folder structure, so we rely on custom headers added by email clients.
		// Gmail uses 'X-Gmail-Labels', and other clients like Thunderbird may use 'X-Folder'.
		const gmailLabels = parsedEmail.headers.get('x-gmail-labels');
		const folderHeader = parsedEmail.headers.get('x-folder');
		let finalPath = '';

		if (gmailLabels && typeof gmailLabels === 'string') {
			// We take the first label as the primary folder.
			// Gmail labels can be hierarchical, but we'll simplify to the first label.
			finalPath = gmailLabels.split(',')[0];
		} else if (folderHeader && typeof folderHeader === 'string') {
			finalPath = folderHeader;
		}

		return {
			id: messageId,
			threadId: threadId,
			from,
			to: mapAddresses(parsedEmail.to),
			cc: mapAddresses(parsedEmail.cc),
			bcc: mapAddresses(parsedEmail.bcc),
			subject: parsedEmail.subject || '',
			body: parsedEmail.text || '',
			html: parsedEmail.html || '',
			headers: parsedEmail.headers,
			attachments,
			receivedAt: parsedEmail.date || new Date(),
			eml: emlBuffer,
			path: finalPath,
		};
	}

	public getUpdatedSyncState(): SyncState {
		return {};
	}
}
