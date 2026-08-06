import { Router } from 'express';
import { StorageController } from '../controllers/storage.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createStorageRouter = (
	storageController: StorageController,
	authService: AuthService
): Router => {
	const router = Router();

	// Secure all routes in this module
	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/storage/download:
	 *   get:
	 *     summary: Download a stored file
	 *     description: >
	 *       Downloads a file from the configured storage backend (local filesystem or S3-compatible).
	 *       The path is sanitized to prevent directory traversal attacks.
	 *       Requires `read:archive` permission.
	 *     operationId: downloadFile
	 *     tags:
	 *       - Storage
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: path
	 *         in: query
	 *         required: true
	 *         description: The relative storage path of the file to download.
	 *         schema:
	 *           type: string
	 *           example: "open-archiver/emails/abc123.eml"
	 *     responses:
	 *       '200':
	 *         description: The file content as a binary stream. The `Content-Disposition` header is set to trigger a browser download.
	 *         headers:
	 *           Content-Disposition:
	 *             description: Attachment filename.
	 *             schema:
	 *               type: string
	 *               example: 'attachment; filename="abc123.eml"'
	 *         content:
	 *           application/octet-stream:
	 *             schema:
	 *               type: string
	 *               format: binary
	 *       '400':
	 *         description: File path is required or invalid.
	 *         content:
	 *           text/plain:
	 *             schema:
	 *               type: string
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         description: File not found in storage.
	 *         content:
	 *           text/plain:
	 *             schema:
	 *               type: string
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get('/download', requirePermission('read', 'archive'), storageController.downloadFile);

	return router;
};
