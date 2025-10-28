import { IStorageProvider, StorageConfig } from '@open-archiver/types';
import { LocalFileSystemProvider } from './storage/LocalFileSystemProvider';
import { S3StorageProvider } from './storage/S3StorageProvider';
import { config } from '../config/index';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { streamToBuffer } from '../helpers/streamToBuffer';
import { Readable } from 'stream';

/**
 *  A unique identifier for Open Archiver encrypted files. This value SHOULD NOT BE ALTERED in future development to ensure compatibility.
 */
const ENCRYPTION_PREFIX = Buffer.from('oa_enc_idf_v1::');

export class StorageService implements IStorageProvider {
	private provider: IStorageProvider;
	private encryptionKey: Buffer | null = null;
	private readonly algorithm = 'aes-256-cbc';

	constructor(storageConfig: StorageConfig = config.storage) {
		if (storageConfig.encryptionKey) {
			this.encryptionKey = Buffer.from(storageConfig.encryptionKey, 'hex');
		}

		switch (storageConfig.type) {
			case 'local':
				this.provider = new LocalFileSystemProvider(storageConfig);
				break;
			case 's3':
				this.provider = new S3StorageProvider(storageConfig);
				break;
			default:
				throw new Error('Invalid storage provider type');
		}
	}

	private async encrypt(content: Buffer): Promise<Buffer> {
		if (!this.encryptionKey) {
			return content;
		}
		const iv = randomBytes(16);
		const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv);
		const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
		return Buffer.concat([ENCRYPTION_PREFIX, iv, encrypted]);
	}

	private async decrypt(content: Buffer): Promise<Buffer> {
		if (!this.encryptionKey) {
			return content;
		}
		const prefix = content.subarray(0, ENCRYPTION_PREFIX.length);
		if (!prefix.equals(ENCRYPTION_PREFIX)) {
			// File is not encrypted, return as is
			return content;
		}

		try {
			const iv = content.subarray(ENCRYPTION_PREFIX.length, ENCRYPTION_PREFIX.length + 16);
			const encrypted = content.subarray(ENCRYPTION_PREFIX.length + 16);
			const decipher = createDecipheriv(this.algorithm, this.encryptionKey, iv);
			return Buffer.concat([decipher.update(encrypted), decipher.final()]);
		} catch (error) {
			// Decryption failed for a file that has the prefix.
			// This indicates a corrupted file or a wrong key.
			throw new Error('Failed to decrypt file. It may be corrupted or the key is incorrect.');
		}
	}

	async put(path: string, content: Buffer | NodeJS.ReadableStream): Promise<void> {
		const buffer =
			content instanceof Buffer
				? content
				: await streamToBuffer(content as NodeJS.ReadableStream);
		const encryptedContent = await this.encrypt(buffer);
		return this.provider.put(path, encryptedContent);
	}

	async get(path: string): Promise<NodeJS.ReadableStream> {
		const stream = await this.provider.get(path);
		const buffer = await streamToBuffer(stream);
		const decryptedContent = await this.decrypt(buffer);
		return Readable.from(decryptedContent);
	}

	public async getStream(path: string): Promise<NodeJS.ReadableStream> {
		const stream = await this.provider.get(path);
		if (!this.encryptionKey) {
			return stream;
		}

		// For encrypted files, we need to read the prefix and IV first.
		// This part still buffers a small, fixed amount of data, which is acceptable.
		const prefixAndIvBuffer = await new Promise<Buffer>((resolve, reject) => {
			const chunks: Buffer[] = [];
			let totalLength = 0;
			const targetLength = ENCRYPTION_PREFIX.length + 16;

			const onData = (chunk: Buffer) => {
				chunks.push(chunk);
				totalLength += chunk.length;
				if (totalLength >= targetLength) {
					stream.removeListener('data', onData);
					resolve(Buffer.concat(chunks));
				}
			};

			stream.on('data', onData);
			stream.on('error', reject);
			stream.on('end', () => {
				// Handle cases where the file is smaller than the prefix + IV
				if (totalLength < targetLength) {
					resolve(Buffer.concat(chunks));
				}
			});
		});

		const prefix = prefixAndIvBuffer.subarray(0, ENCRYPTION_PREFIX.length);
		if (!prefix.equals(ENCRYPTION_PREFIX)) {
			// File is not encrypted, return a new stream containing the buffered prefix and the rest of the original stream
			const combinedStream = new Readable({
				read() { },
			});
			combinedStream.push(prefixAndIvBuffer);
			stream.on('data', (chunk) => {
				combinedStream.push(chunk);
			});
			stream.on('end', () => {
				combinedStream.push(null); // No more data
			});
			stream.on('error', (err) => {
				combinedStream.emit('error', err);
			});
			return combinedStream;
		}

		try {
			const iv = prefixAndIvBuffer.subarray(
				ENCRYPTION_PREFIX.length,
				ENCRYPTION_PREFIX.length + 16
			);
			const decipher = createDecipheriv(this.algorithm, this.encryptionKey, iv);

			// Push the remaining part of the initial buffer to the decipher
			const remainingBuffer = prefixAndIvBuffer.subarray(ENCRYPTION_PREFIX.length + 16);
			if (remainingBuffer.length > 0) {
				decipher.write(remainingBuffer);
			}

			// Pipe the rest of the stream
			stream.pipe(decipher);

			return decipher;
		} catch (error) {
			throw new Error('Failed to decrypt file. It may be corrupted or the key is incorrect.');
		}
	}

	delete(path: string): Promise<void> {
		return this.provider.delete(path);
	}

	exists(path: string): Promise<boolean> {
		return this.provider.exists(path);
	}
}
