import { Router } from 'express';
import { uploadFile } from '../controllers/upload.controller';
import { requireAuth } from '../middleware/requireAuth';
import { AuthService } from '../../services/AuthService';
import { requirePermission } from '../middleware/requirePermission';

export const createUploadRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/upload:
	 *   post:
	 *     summary: Upload a file
	 *     description: >
	 *       Uploads a file (PST, EML, MBOX, or other) to temporary storage for subsequent use in an ingestion source.
	 *       Returns the storage path, which should be passed as `uploadedFilePath` when creating a file-based ingestion source.
	 *       Requires `create:ingestion` permission.
	 *     operationId: uploadFile
	 *     tags:
	 *       - Upload
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         multipart/form-data:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               file:
	 *                 type: string
	 *                 format: binary
	 *                 description: The file to upload.
	 *     responses:
	 *       '200':
	 *         description: File uploaded successfully. Returns the storage path.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 filePath:
	 *                   type: string
	 *                   description: The storage path of the uploaded file. Use this as `uploadedFilePath` when creating a file-based ingestion source.
	 *                   example: "open-archiver/tmp/uuid-filename.pst"
	 *       '400':
	 *         description: Invalid multipart request.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post('/', requirePermission('create', 'ingestion'), uploadFile);

	return router;
};
