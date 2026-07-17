import { IStorageProvider, LocalStorageConfig } from '@open-archiver/types';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

export class LocalFileSystemProvider implements IStorageProvider {
	private readonly rootPath: string;

	constructor(config: LocalStorageConfig) {
		this.rootPath = config.rootPath;
	}

	async put(filePath: string, content: Buffer | NodeJS.ReadableStream): Promise<void> {
		const fullPath = path.join(this.rootPath, filePath);
		const dir = path.dirname(fullPath);
		await fs.mkdir(dir, { recursive: true });

		if (Buffer.isBuffer(content)) {
			await fs.writeFile(fullPath, content);
		} else {
			const writeStream = createWriteStream(fullPath);
			await pipeline(content, writeStream);
		}
	}

	/**
	 * Resolves a stored relative path to the exact path on disk.
	 *
	 * Attachment filenames can reach this provider in either Unicode NFC or NFD
	 * normalization form, depending on the mail client that composed the original
	 * message. The path recorded in the database is not guaranteed to use the same
	 * normalization form as the byte sequence that was actually written to disk by
	 * `put()`. Linux filesystems compare filenames byte-for-byte and do not
	 * normalize Unicode, so a naive `fs.access` on the DB-provided path can fail
	 * with ENOENT even though a canonically identical file exists on disk.
	 *
	 * We try the exact path first (fast path, zero behavior change for the common
	 * ASCII case), then fall back to the NFC and NFD forms before giving up.
	 */
	private async resolveExistingPath(filePath: string): Promise<string | null> {
		const candidates = Array.from(
			new Set([filePath, filePath.normalize('NFC'), filePath.normalize('NFD')])
		);

		for (const candidate of candidates) {
			const fullPath = path.join(this.rootPath, candidate);
			try {
				await fs.access(fullPath);
				return fullPath;
			} catch {
				// try next candidate
			}
		}

		return null;
	}

	async get(filePath: string): Promise<NodeJS.ReadableStream> {
		const fullPath = await this.resolveExistingPath(filePath);
		if (!fullPath) {
			throw new Error('File not found');
		}
		return createReadStream(fullPath);
	}

	async delete(filePath: string): Promise<void> {
		const fullPath = (await this.resolveExistingPath(filePath)) ?? path.join(this.rootPath, filePath);
		try {
			await fs.rm(fullPath, { recursive: true, force: true });
		} catch (error: any) {
			// Even with force: true, other errors might occur (e.g., permissions)
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
	}

	async exists(filePath: string): Promise<boolean> {
		return (await this.resolveExistingPath(filePath)) !== null;
	}
}
