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
	 * Resolves a stored relative path to the actual full path on disk, tolerating a
	 * Unicode normalization mismatch (NFC vs NFD) between the stored path and the
	 * on-disk filename bytes (#409).
	 *
	 * We always write the same string to disk and to the database, so on a
	 * byte-preserving filesystem (ext4/xfs/btrfs) the exact path matches on the first
	 * try and this is a no-op. The mismatch only arises with storage layers that
	 * rewrite filename bytes on write while staying byte-sensitive on read — notably
	 * Docker Desktop bind mounts on macOS and some SMB/CIFS/NFS shares, which can turn
	 * a written NFC name into NFD on disk. Trying the NFC and NFD forms as fallbacks
	 * makes the lookup robust regardless of where the divergence originates.
	 *
	 * Returns the resolved full path, or null if no candidate exists.
	 */
	private async resolveExistingPath(filePath: string): Promise<string | null> {
		// Exact form first: zero behavior change / cost for the common case.
		const candidates = Array.from(
			new Set([filePath, filePath.normalize('NFC'), filePath.normalize('NFD')])
		);

		for (const candidate of candidates) {
			const fullPath = path.join(this.rootPath, candidate);
			try {
				await fs.access(fullPath);
				return fullPath;
			} catch {
				// Try the next normalization form.
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
		// Fall back to the exact path when unresolved so a missing file stays a no-op
		// (rm with force: true ignores ENOENT).
		const fullPath =
			(await this.resolveExistingPath(filePath)) ?? path.join(this.rootPath, filePath);
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
