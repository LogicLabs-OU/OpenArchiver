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

	return router;
};
