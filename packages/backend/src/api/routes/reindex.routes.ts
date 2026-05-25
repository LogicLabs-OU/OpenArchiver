import { Router } from 'express';
import { ReindexController } from '../controllers/reindex.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createReindexRouter = (authService: AuthService): Router => {
	const router = Router();
	const controller = new ReindexController();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/admin/reindex:
	 *   post:
	 *     summary: Start a reindex job
	 *     description: |
	 *       Enqueues a reindex orchestrator job that drains `archived_emails`
	 *       in cursor-paginated pages and pushes `index-email-batch` jobs onto
	 *       the existing indexing queue. Requires `manage:all` (Super Admin)
	 *       permission.
	 *     operationId: startReindex
	 *     tags:
	 *       - Admin / Reindex
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - scope
	 *             properties:
	 *               scope:
	 *                 type: string
	 *                 enum: [full, date, new-fields-only]
	 *               ingestionSourceId:
	 *                 type: string
	 *                 format: uuid
	 *               dateFrom:
	 *                 type: string
	 *                 format: date-time
	 *               dateTo:
	 *                 type: string
	 *                 format: date-time
	 *               batchSize:
	 *                 type: integer
	 *                 minimum: 1
	 *                 maximum: 5000
	 *     responses:
	 *       '202':
	 *         description: Job accepted.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 jobId:
	 *                   type: string
	 *       '400':
	 *         $ref: '#/components/responses/BadRequest'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post(
		'/',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		controller.start
	);

	/**
	 * @openapi
	 * /v1/admin/reindex/{jobId}:
	 *   get:
	 *     summary: Get reindex job status
	 *     operationId: getReindexStatus
	 *     tags:
	 *       - Admin / Reindex
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: jobId
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *     responses:
	 *       '200':
	 *         description: Current job state and progress snapshot.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '404':
	 *         description: Job not found.
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get(
		'/:jobId',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		controller.status
	);

	/**
	 * @openapi
	 * /v1/admin/reindex/{jobId}/cancel:
	 *   post:
	 *     summary: Cancel a reindex orchestrator job
	 *     description: |
	 *       Stops further `index-email-batch` jobs being enqueued. Already-
	 *       dispatched batches continue to run.
	 *     operationId: cancelReindex
	 *     tags:
	 *       - Admin / Reindex
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: jobId
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *     responses:
	 *       '204':
	 *         description: Job cancelled.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '404':
	 *         description: Job not found.
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post(
		'/:jobId/cancel',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		controller.cancel
	);

	return router;
};
