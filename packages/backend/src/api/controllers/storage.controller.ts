import { Request, Response } from 'express';
import { StorageService } from '../../services/StorageService';
import * as path from 'path';
import { storage as storageConfig } from '../../config/storage';
import { logger } from '../../config/logger';

export class StorageController {
	constructor(private storageService: StorageService) {}

	public downloadFile = async (req: Request, res: Response): Promise<void> => {
		const unsafePath = req.query.path as string;

		if (!unsafePath) {
			res.status(400).send(req.t('storage.filePathRequired'));
			return;
		}

		// Normalize the path to prevent directory traversal
		const normalizedPath = path.normalize(unsafePath).replace(/^(\.\.(\/|\\|$))+/, '');

		// Determine the base path from storage configuration
		const basePath = storageConfig.type === 'local' ? storageConfig.rootPath : '/';

		// Resolve the full path and ensure it's within the storage directory
		const fullPath = path.join(basePath, normalizedPath);

		if (!fullPath.startsWith(basePath)) {
			res.status(400).send(req.t('storage.invalidFilePath'));
			return;
		}

		// Use the sanitized, relative path for storage service operations
		const safePath = path.relative(basePath, fullPath);

		try {
			const fileExists = await this.storageService.exists(safePath);
			if (!fileExists) {
				res.status(404).send(req.t('storage.fileNotFound'));
				return;
			}

			const fileStream = await this.storageService.get(safePath);
			const fileName = path.basename(safePath);
			// Use res.attachment() so the filename is RFC 6266/5987-encoded (dual
			// filename="..."; filename*=UTF-8''...). Setting the header with a raw non-ASCII
			// filename throws ERR_INVALID_CHAR and returns 500 (#406).
			res.attachment(fileName);
			fileStream.pipe(res);
		} catch (error) {
			logger.error({ error, path: safePath }, 'Error downloading file');
			res.status(500).send(req.t('storage.downloadError'));
		}
	};
}
