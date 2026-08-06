import { Request, Response } from 'express';
import { StorageService } from '../../services/StorageService';
import { randomUUID } from 'crypto';
import busboy from 'busboy';
import { config } from '../../config/index';
import { logger } from '../../config/logger';
import i18next from 'i18next';

export const uploadFile = async (req: Request, res: Response) => {
	const storage = new StorageService();
	const uploads: Promise<void>[] = [];
	let filePath = '';
	let originalFilename = '';
	let headersSent = false;
	const contentLength = req.headers['content-length'];

	logger.info({ contentLength, contentType: req.headers['content-type'] }, 'File upload started');

	const sendErrorResponse = (statusCode: number, message: string) => {
		if (!headersSent) {
			headersSent = true;
			res.status(statusCode).json({
				status: 'error',
				statusCode,
				message,
				errors: null,
			});
		}
	};

	let bb: busboy.Busboy;
	try {
		bb = busboy({ headers: req.headers });
	} catch (err) {
		const message = err instanceof Error ? err.message : i18next.t('upload.invalid_request');
		logger.error({ error: message }, 'Failed to initialize file upload parser');
		sendErrorResponse(400, i18next.t('upload.invalid_request'));
		return;
	}

	bb.on('file', (fieldname, file, info) => {
		originalFilename = info.filename;
		const uuid = randomUUID();
		filePath = `${config.storage.openArchiverFolderName}/tmp/${uuid}-${originalFilename}`;

		logger.info({ filename: originalFilename, fieldname }, 'Receiving file stream');

		file.on('error', (err) => {
			logger.error(
				{ error: err.message, filename: originalFilename },
				'File stream error during upload'
			);
			sendErrorResponse(500, i18next.t('upload.stream_error'));
		});

		uploads.push(storage.put(filePath, file));
	});

	bb.on('error', (err: Error) => {
		logger.error({ error: err.message }, 'Upload parsing error');
		sendErrorResponse(500, i18next.t('upload.parse_error'));
	});

	bb.on('finish', async () => {
		try {
			await Promise.all(uploads);
			if (!headersSent) {
				headersSent = true;
				logger.info(
					{ filePath, filename: originalFilename },
					'File upload completed successfully'
				);
				res.json({ filePath });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown storage error';
			logger.error(
				{ error: message, filename: originalFilename, filePath },
				'Failed to write uploaded file to storage'
			);
			sendErrorResponse(500, i18next.t('upload.storage_error'));
		}
	});

	// Handle client disconnection mid-upload
	req.on('error', (err) => {
		logger.warn(
			{ error: err.message, filename: originalFilename },
			'Client connection error during upload'
		);
		sendErrorResponse(499, i18next.t('upload.connection_error'));
	});

	req.on('aborted', () => {
		logger.warn({ filename: originalFilename }, 'Client aborted upload');
	});

	req.pipe(bb);
};
