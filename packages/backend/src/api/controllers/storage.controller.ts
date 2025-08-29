import { Request, Response } from 'express';
import { StorageService } from '../../services/StorageService';
import * as path from 'path';
import { storage as storageConfig } from '../../config/storage';

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
			res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
			fileStream.pipe(res);
		} catch (error) {
			console.error('Error downloading file:', error);
			res.status(500).send(req.t('storage.downloadError'));
		}
	};
}
