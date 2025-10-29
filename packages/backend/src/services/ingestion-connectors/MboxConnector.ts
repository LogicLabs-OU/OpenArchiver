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
import { Readable, Transform } from 'stream';
import { createHash } from 'crypto';

class MboxSplitter extends Transform {
	private buffer: Buffer = Buffer.alloc(0);
	private delimiter: Buffer = Buffer.from('\nFrom ');
	private firstChunk: boolean = true;

	_transform(chunk: Buffer, encoding: string, callback: Function) {
		if (this.firstChunk) {
			// Check if the file starts with "From ". If not, prepend it to the first email.
			if (chunk.subarray(0, 5).toString() !== 'From ') {
				this.push(Buffer.from('From '));
			}
			this.firstChunk = false;
		}

		let currentBuffer = Buffer.concat([this.buffer, chunk]);
		let position;

		while ((position = currentBuffer.indexOf(this.delimiter)) > -1) {
			const email = currentBuffer.subarray(0, position);
			if (email.length > 0) {
				this.push(email);
			}
			// The next email starts with "From ", which is what the parser expects.
			currentBuffer = currentBuffer.subarray(position + 1);
		}

		this.buffer = currentBuffer;
		callback();
	}

	_flush(callback: Function) {
		if (this.buffer.length > 0) {
			this.push(this.buffer);
		}
		callback();
	}
}

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
		const fileStream = await this.storage.getStream(this.credentials.uploadedFilePath);
		const mboxSplitter = new MboxSplitter();
		const emailStream = fileStream.pipe(mboxSplitter);

		for await (const emailBuffer of emailStream) {
			try {
				const emailObject = await this.parseMessage(emailBuffer as Buffer, '');
				yield emailObject;
			} catch (error) {
				logger.error(
					{ error, file: this.credentials.uploadedFilePath },
					'Failed to process a single message from mbox file. Skipping.'
				);
			}
		}

		// After the stream is fully consumed, delete the file.
		// The `for await...of` loop ensures streams are properly closed on completion,
		// so we can safely delete the file here without causing a hang.
		try {
			await this.storage.delete(this.credentials.uploadedFilePath);
		} catch (error) {
			logger.error(
				{ error, file: this.credentials.uploadedFilePath },
				'Failed to delete mbox file after processing.'
			);
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
