import { Request, Response } from 'express';
import { StorageService } from '../../services/StorageService';
import { randomUUID } from 'crypto';
import busboy from 'busboy';
import { config } from '../../config/index';

export const uploadFile = async (req: Request, res: Response) => {
	const storage = new StorageService();
	const bb = busboy({ headers: req.headers });
	const uploads: Promise<void>[] = [];
	let filePath = '';
	let originalFilename = '';

	bb.on('file', (fieldname, file, filename) => {
		originalFilename = filename.filename;
		const uuid = randomUUID();
		filePath = `${config.storage.openArchiverFolderName}/tmp/${uuid}-${originalFilename}`;
		uploads.push(storage.put(filePath, file));
	});

	bb.on('finish', async () => {
		await Promise.all(uploads);
		res.json({ filePath });
	});

	req.pipe(bb);
};
