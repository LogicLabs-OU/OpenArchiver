import { Router } from 'express';
import { IndexAdminController } from '../controllers/index-admin.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createIndexAdminRouter = (authService: AuthService): Router => {
	const router = Router();
	const indexAdminController = new IndexAdminController();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/index-admin/overview:
	 *   get:
	 *     summary: Search engine overview
	 *     description: Returns Meilisearch instance info (host, version, health, database size) and the `emails` index metadata (document count, primary key, indexing state, field distribution). Read-only. Requires `manage:all` (Super Admin) permission.
	 *     operationId: getSearchIndexOverview
	 *     tags:
	 *       - Index Admin
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: Search engine overview.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.get(
		'/overview',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		indexAdminController.getOverview
	);

	/**
	 * @openapi
	 * /v1/index-admin/tasks:
	 *   get:
	 *     summary: Search engine task list
	 *     description: Returns a cursor-paginated list of Meilisearch tasks for the `emails` index, optionally filtered by status/type. Read-only. Requires `manage:all` (Super Admin) permission.
	 *     operationId: getSearchIndexTasks
	 *     tags:
	 *       - Index Admin
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: limit
	 *         in: query
	 *         required: false
	 *         schema:
	 *           type: integer
	 *           default: 20
	 *       - name: from
	 *         in: query
	 *         required: false
	 *         description: Cursor (task uid) to page from.
	 *         schema:
	 *           type: integer
	 *       - name: statuses
	 *         in: query
	 *         required: false
	 *         description: Comma-separated statuses (enqueued,processing,succeeded,failed,canceled).
	 *         schema:
	 *           type: string
	 *       - name: types
	 *         in: query
	 *         required: false
	 *         description: Comma-separated task types.
	 *         schema:
	 *           type: string
	 *     responses:
	 *       '200':
	 *         description: Paginated task list.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.get(
		'/tasks',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		indexAdminController.getTasks
	);

	/**
	 * @openapi
	 * /v1/index-admin/orphans/cleanup:
	 *   post:
	 *     summary: Remove orphaned search index documents
	 *     description: Queues a background sweep that deletes documents from the `emails` index whose archived email no longer exists in the database. These are left behind when a deletion removes the database row but its search index counterpart never completes, and they surface as search results that cannot be opened. No emails, attachments or stored files are touched. Requires `manage:all` (Super Admin) permission.
	 *     operationId: cleanupOrphanedIndexDocuments
	 *     tags:
	 *       - Index Admin
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '202':
	 *         description: Cleanup job accepted and queued.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 message:
	 *                   type: string
	 *                 estimatedOrphans:
	 *                   type: integer
	 *                   description: Index documents minus archived rows. A floor, not an exact count.
	 *                 workerAlive:
	 *                   type: boolean
	 *                   description: Whether an indexing worker is available to run the sweep.
	 *                 alreadyRunning:
	 *                   type: boolean
	 *                   description: True when a sweep was already queued or running, so this request joined it instead of starting a second one.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.post(
		'/orphans/cleanup',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		indexAdminController.cleanupOrphans
	);

	return router;
};
