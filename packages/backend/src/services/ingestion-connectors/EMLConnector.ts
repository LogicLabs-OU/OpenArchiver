import type {
	EMLImportCredentials,
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
import { join, dirname } from 'path';
import { createReadStream, promises as fs, createWriteStream } from 'fs';
import * as yauzl from 'yauzl';

const streamToBuffer = (stream: Readable): Promise<Buffer> => {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on('data', (chunk) => chunks.push(chunk));
		stream.on('error', reject);
		stream.on('end', () => resolve(Buffer.concat(chunks)));
	});
};

export class EMLConnector implements IEmailConnector {
	private storage: StorageService;

	constructor(private credentials: EMLImportCredentials) {
		this.storage = new StorageService();
	}

	public async testConnection(): Promise<boolean> {
		try {
			if (!this.credentials.uploadedFilePath) {
				throw Error('EML file path not provided.');
			}
			if (!this.credentials.uploadedFilePath.includes('.zip')) {
				throw Error('Provided file is not in the ZIP format.');
			}
			const fileExist = await this.storage.exists(this.credentials.uploadedFilePath);
			if (!fileExist) {
				throw Error('EML file upload not finished yet, please wait.');
			}

			return true;
		} catch (error) {
			logger.error({ error, credentials: this.credentials }, 'EML file validation failed.');
			throw error;
		}
	}

	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		const displayName =
			this.credentials.uploadedFileName || `eml-import-${new Date().getTime()}`;
		logger.info(`Found potential mailbox: ${displayName}`);
		const constructedPrimaryEmail = `${displayName.replace(/ /g, '.').toLowerCase()}@eml.local`;
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
		const fileStream = await this.storage.get(this.credentials.uploadedFilePath);
		const tempDir = await fs.mkdtemp(join('/tmp', `eml-import-${new Date().getTime()}`));
		const unzippedPath = join(tempDir, 'unzipped');
		await fs.mkdir(unzippedPath);
		const zipFilePath = join(tempDir, 'eml.zip');

		try {
			await new Promise<void>((resolve, reject) => {
				const dest = createWriteStream(zipFilePath);
				(fileStream as Readable).pipe(dest);
				dest.on('finish', () => resolve());
				dest.on('error', reject);
			});

			await this.extract(zipFilePath, unzippedPath);

			const files = await this.getAllFiles(unzippedPath);

			for (const file of files) {
				if (file.endsWith('.eml')) {
					try {
						// logger.info({ file }, 'Processing EML file.');
						const stream = createReadStream(file);
						const content = await streamToBuffer(stream);
						// logger.info({ file, size: content.length }, 'Read file to buffer.');
						let relativePath = file.substring(unzippedPath.length + 1);
						if (dirname(relativePath) === '.') {
							relativePath = '';
						} else {
							relativePath = dirname(relativePath);
						}
						const emailObject = await this.parseMessage(content, relativePath);
						// logger.info({ file, messageId: emailObject.id }, 'Parsed email message.');
						yield emailObject;
					} catch (error) {
						logger.error(
							{ error, file },
							'Failed to process a single EML file. Skipping.'
						);
					}
				}
			}
		} catch (error) {
			logger.error({ error }, 'Failed to fetch email.');
			throw error;
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
			try {
				await this.storage.delete(this.credentials.uploadedFilePath);
			} catch (error) {
				logger.error(
					{ error, file: this.credentials.uploadedFilePath },
					'Failed to delete EML file after processing.'
				);
			}
		}
	}

	private extract(zipFilePath: string, dest: string): Promise<void> {
		return new Promise((resolve, reject) => {
			yauzl.open(zipFilePath, { lazyEntries: true, decodeStrings: false }, (err, zipfile) => {
				if (err) reject(err);
				zipfile.on('error', reject);
				zipfile.readEntry();
				zipfile.on('entry', (entry) => {
					const fileName = entry.fileName.toString('utf8');
					// Ignore macOS-specific metadata files.
					if (fileName.startsWith('__MACOSX/')) {
						zipfile.readEntry();
						return;
					}
					const entryPath = join(dest, fileName);
					if (/\/$/.test(fileName)) {
						fs.mkdir(entryPath, { recursive: true })
							.then(() => zipfile.readEntry())
							.catch(reject);
					} else {
						zipfile.openReadStream(entry, (err, readStream) => {
							if (err) reject(err);
							const writeStream = createWriteStream(entryPath);
							readStream.pipe(writeStream);
							writeStream.on('finish', () => zipfile.readEntry());
							writeStream.on('error', reject);
						});
					}
				});
				zipfile.on('end', () => resolve());
			});
		});
	}

	private async getAllFiles(dirPath: string, arrayOfFiles: string[] = []): Promise<string[]> {
		const files = await fs.readdir(dirPath);

		for (const file of files) {
			const fullPath = join(dirPath, file);
			if ((await fs.stat(fullPath)).isDirectory()) {
				await this.getAllFiles(fullPath, arrayOfFiles);
			} else {
				arrayOfFiles.push(fullPath);
			}
		}

		return arrayOfFiles;
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
			path,
		};
	}

	public getUpdatedSyncState(): SyncState {
		return {};
	}
}
