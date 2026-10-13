import { IStorageProvider, LocalStorageConfig, StoragePutOptions } from '@open-archiver/types';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { logger } from '../../config/logger';
import { StorageObjectExistsError } from './errors';

/** Errors from link(2) that mean "this filesystem has no usable hard links". */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']);

export class LocalFileSystemProvider implements IStorageProvider {
	private readonly rootPath: string;
	/** Sticky once link(2) has proved unusable here, so the fallback is chosen directly. */
	private linkUnsupported = false;

	constructor(config: LocalStorageConfig) {
		this.rootPath = config.rootPath;
	}

	async put(
		filePath: string,
		content: Buffer | NodeJS.ReadableStream,
		options?: StoragePutOptions
	): Promise<void> {
		const fullPath = path.join(this.rootPath, filePath);
		const dir = path.dirname(fullPath);
		await fs.mkdir(dir, { recursive: true });

		if (options?.overwrite === false) {
			return this.putIfAbsent(filePath, fullPath, dir, content);
		}

		if (Buffer.isBuffer(content)) {
			await fs.writeFile(fullPath, content);
		} else {
			const writeStream = createWriteStream(fullPath);
			await pipeline(content, writeStream);
		}
	}

	/**
	 * Stores content only if nothing is at the path yet, and never lets a half-written file appear
	 * under the final name.
	 *
	 * Opening the final name with 'wx' would be atomic about *claiming* it but not about filling
	 * it: a worker killed between the create and the last byte (OOM, SIGKILL, ENOSPC) leaves a
	 * truncated file with no database row behind it. The retry then finds the path taken, adopts
	 * the fragment, and stores a hash of the truncated bytes — which verifies forever. So the
	 * bytes go to a private temp name first and the final name is published in one atomic step.
	 *
	 * link(2) is that step: it fails with EEXIST rather than replacing, which is exactly the
	 * refusal this option promises, and the name only ever resolves to a complete file. A
	 * filesystem without usable hard links falls back to rename(2), which is still atomic on
	 * publish — only the claim is racy there, leaving the pre-existing window rather than a new
	 * failure mode.
	 */
	private async putIfAbsent(
		filePath: string,
		fullPath: string,
		dir: string,
		content: Buffer | NodeJS.ReadableStream
	): Promise<void> {
		// Same directory, so the publish stays within one filesystem. The '.partial' suffix marks
		// it for an operator; the uuid keeps concurrent writers off each other's temp file.
		const tempPath = path.join(dir, `.${path.basename(fullPath)}.${randomUUID()}.partial`);

		try {
			if (Buffer.isBuffer(content)) {
				await fs.writeFile(tempPath, content);
			} else {
				await pipeline(content, createWriteStream(tempPath));
			}

			if (!this.linkUnsupported) {
				try {
					await fs.link(tempPath, fullPath);
					return;
				} catch (error) {
					const code = (error as NodeJS.ErrnoException).code;
					if (code === 'EEXIST') {
						throw new StorageObjectExistsError(filePath);
					}
					if (!code || !LINK_UNSUPPORTED.has(code)) {
						throw error;
					}
					this.linkUnsupported = true;
					logger.warn(
						{ err: error, rootPath: this.rootPath },
						'Filesystem does not support hard links; conditional writes fall back to rename, which cannot refuse an existing path atomically'
					);
				}
			}

			// Fallback: check, then publish atomically. The check is not fused to the publish, so
			// two writers can both pass it — the caller's own serialisation covers that — but a
			// partial file is still never visible under the final name.
			if (await this.exists(filePath)) {
				throw new StorageObjectExistsError(filePath);
			}
			await fs.rename(tempPath, fullPath);
		} finally {
			// After a successful link the final name holds the inode, so dropping the temp name is
			// just cleanup; after rename the temp name is already gone (ENOENT).
			await fs.rm(tempPath, { force: true }).catch(() => undefined);
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
