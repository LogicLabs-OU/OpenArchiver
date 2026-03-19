import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createDashboardRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/dashboard/stats:
	 *   get:
	 *     summary: Get dashboard stats
	 *     description: Returns high-level statistics including total archived emails, total storage used, and failed ingestions in the last 7 days. Requires `read:dashboard` permission.
	 *     operationId: getDashboardStats
	 *     tags:
	 *       - Dashboard
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: Dashboard statistics.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/DashboardStats'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.get(
		'/stats',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getStats
	);

	/**
	 * @openapi
	 * /v1/dashboard/ingestion-history:
	 *   get:
	 *     summary: Get ingestion history
	 *     description: Returns time-series data of email ingestion counts for the last 30 days. Requires `read:dashboard` permission.
	 *     operationId: getIngestionHistory
	 *     tags:
	 *       - Dashboard
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: Ingestion history wrapped in a `history` array.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 history:
	 *                   type: array
	 *                   items:
	 *                     type: object
	 *                     properties:
	 *                       date:
	 *                         type: string
	 *                         format: date-time
	 *                         description: Truncated to day precision (UTC).
	 *                       count:
	 *                         type: integer
	 *               required:
	 *                 - history
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.get(
		'/ingestion-history',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getIngestionHistory
	);

	/**
	 * @openapi
	 * /v1/dashboard/ingestion-sources:
	 *   get:
	 *     summary: Get ingestion source summaries
	 *     description: Returns a summary list of ingestion sources with their storage usage. Requires `read:dashboard` permission.
	 *     operationId: getDashboardIngestionSources
	 *     tags:
	 *       - Dashboard
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: List of ingestion source summaries.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 $ref: '#/components/schemas/IngestionSourceStats'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.get(
		'/ingestion-sources',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getIngestionSources
	);

	/**
	 * @openapi
	 * /v1/dashboard/recent-syncs:
	 *   get:
	 *     summary: Get recent sync activity
	 *     description: Returns the most recent sync sessions across all ingestion sources. Requires `read:dashboard` permission.
	 *     operationId: getRecentSyncs
	 *     tags:
	 *       - Dashboard
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: List of recent sync sessions.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 $ref: '#/components/schemas/RecentSync'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.get(
		'/recent-syncs',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getRecentSyncs
	);

	/**
	 * @openapi
	 * /v1/dashboard/indexed-insights:
	 *   get:
	 *     summary: Get indexed email insights
	 *     description: Returns top-sender statistics from the search index. Requires `read:dashboard` permission.
	 *     operationId: getIndexedInsights
	 *     tags:
	 *       - Dashboard
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: Indexed email insights.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/IndexedInsights'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.get(
		'/indexed-insights',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getIndexedInsights
	);

	return router;
};
