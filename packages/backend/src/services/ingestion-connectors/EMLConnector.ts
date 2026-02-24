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

	private getFilePath(): string {
		return this.credentials.localFilePath || this.credentials.uploadedFilePath || '';
	}

	private getDisplayName(): string {
		if (this.credentials.uploadedFileName) {
			return this.credentials.uploadedFileName;
		}
		if (this.credentials.localFilePath) {
			const parts = this.credentials.localFilePath.split('/');
			return parts[parts.length - 1].replace('.zip', '');
		}
		return `eml-import-${new Date().getTime()}`;
	}

	private async getFileStream(): Promise<NodeJS.ReadableStream> {
		if (this.credentials.localFilePath) {
			return createReadStream(this.credentials.localFilePath);
		}
		return this.storage.get(this.getFilePath());
	}

	public async testConnection(): Promise<boolean> {
		try {
			const filePath = this.getFilePath();
			if (!filePath) {
				throw Error('EML Zip file path not provided.');
			}
			if (!filePath.includes('.zip')) {
				throw Error('Provided file is not in the ZIP format.');
			}

			let fileExist = false;
			if (this.credentials.localFilePath) {
				try {
					await fs.access(this.credentials.localFilePath);
					fileExist = true;
				} catch {
					fileExist = false;
				}
			} else {
				fileExist = await this.storage.exists(filePath);
			}

			if (!fileExist) {
				if (this.credentials.localFilePath) {
					throw Error(`EML Zip file not found at path: ${this.credentials.localFilePath}`);
				} else {
					throw Error(
						'Uploaded EML Zip file not found. The upload may not have finished yet, or it failed.'
					);
				}
			}

			return true;
		} catch (error) {
			logger.error(
				{ error, credentials: this.credentials },
				'EML Zip file validation failed.'
			);
			throw error;
		}
	}

	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		const displayName = this.getDisplayName();
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
		const fileStream = await this.getFileStream();
		const tempDir = await fs.mkdtemp(join('/tmp', `eml-import-${new Date().getTime()}`));
		const zipFilePath = join(tempDir, 'eml.zip');

		try {
			await new Promise<void>((resolve, reject) => {
				const dest = createWriteStream(zipFilePath);
				(fileStream as Readable).pipe(dest);
				dest.on('finish', () => resolve());
				dest.on('error', reject);
			});

			yield* this.processZipEntries(zipFilePath);
		} catch (error) {
			logger.error({ error }, 'Failed to fetch email.');
			throw error;
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
			if (this.credentials.uploadedFilePath && !this.credentials.localFilePath) {
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
	}

	private async *processZipEntries(zipFilePath: string): AsyncGenerator<EmailObject | null> {
		// Open the ZIP file.
		// Note: yauzl requires random access, so we must use the file on disk.
		const zipfile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
			yauzl.open(zipFilePath, { lazyEntries: true, decodeStrings: false }, (err, zipfile) => {
				if (err || !zipfile) return reject(err);
				resolve(zipfile);
			});
		});

		// Create an async iterator for zip entries
		const entryIterator = this.zipEntryGenerator(zipfile);

		for await (const { entry, openReadStream } of entryIterator) {
			const fileName = entry.fileName.toString();
			if (fileName.startsWith('__MACOSX/') || /\/$/.test(fileName)) {
				continue;
			}

			if (fileName.endsWith('.eml')) {
				try {
					const readStream = await openReadStream();
					const relativePath = dirname(fileName) === '.' ? '' : dirname(fileName);
					const emailObject = await this.parseMessage(readStream, relativePath);
					yield emailObject;
				} catch (error) {
					logger.error(
						{ error, file: fileName },
						'Failed to process a single EML file from zip. Skipping.'
					);
				}
			}
		}
	}

	private async *zipEntryGenerator(
		zipfile: yauzl.ZipFile
	): AsyncGenerator<{ entry: yauzl.Entry; openReadStream: () => Promise<Readable> }> {
		let resolveNext: ((value: any) => void) | null = null;
		let rejectNext: ((reason?: any) => void) | null = null;
		let finished = false;
		const queue: yauzl.Entry[] = [];

		zipfile.readEntry();

		zipfile.on('entry', (entry) => {
			if (resolveNext) {
				const resolve = resolveNext;
				resolveNext = null;
				rejectNext = null;
				resolve(entry);
			} else {
				queue.push(entry);
			}
		});

		zipfile.on('end', () => {
			finished = true;
			if (resolveNext) {
				const resolve = resolveNext;
				resolveNext = null;
				rejectNext = null;
				resolve(null); // Signal end
			}
		});

		zipfile.on('error', (err) => {
			finished = true;
			if (rejectNext) {
				const reject = rejectNext;
				resolveNext = null;
				rejectNext = null;
				reject(err);
			}
		});

		while (!finished || queue.length > 0) {
			if (queue.length > 0) {
				const entry = queue.shift()!;
				yield {
					entry,
					openReadStream: () =>
						new Promise<Readable>((resolve, reject) => {
							zipfile.openReadStream(entry, (err, stream) => {
								if (err || !stream) return reject(err);
								resolve(stream);
							});
						}),
				};
				zipfile.readEntry(); // Read next entry only after yielding
			} else {
				const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
					resolveNext = resolve;
					rejectNext = reject;
				});
				if (entry) {
					yield {
						entry,
						openReadStream: () =>
							new Promise<Readable>((resolve, reject) => {
								zipfile.openReadStream(entry, (err, stream) => {
									if (err || !stream) return reject(err);
									resolve(stream);
								});
							}),
					};
					zipfile.readEntry(); // Read next entry only after yielding
				} else {
					break; // End of zip
				}
			}
		}
	}

	private async parseMessage(
		input: Buffer | Readable,
		path: string
	): Promise<EmailObject> {
		let emlBuffer: Buffer;
		if (Buffer.isBuffer(input)) {
			emlBuffer = input;
		} else {
			emlBuffer = await streamToBuffer(input);
		}

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
