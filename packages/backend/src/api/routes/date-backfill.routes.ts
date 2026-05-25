import { Router } from 'express';
import { DateBackfillController } from '../controllers/date-backfill.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createDateBackfillRouter = (authService: AuthService): Router => {
	const router = Router();
	const controller = new DateBackfillController();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/admin/jobs/date-backfill:
	 *   post:
	 *     summary: Start a date-backfill job
	 *     description: |
	 *       Enqueues a planner job that scans `archived_emails WHERE
	 *       date_backfilled_at IS NULL`, fan-outs batch jobs that re-parse
	 *       each row's stored EML and update `sent_at` /
	 *       `original_date_source` using the dateExtractor fallback chain,
	 *       and triggers a reindex for the rows whose date actually changed.
	 *
	 *       Idempotent — re-running picks up where it left off. Requires
	 *       `manage:all` (Super Admin) permission.
	 *     operationId: startDateBackfill
	 *     tags:
	 *       - Admin / Date Backfill
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     requestBody:
	 *       required: false
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               ingestionSourceId:
	 *                 type: string
	 *                 format: uuid
	 *                 description: Narrow the scan to a single ingestion source.
	 *               batchSize:
	 *                 type: integer
	 *                 minimum: 1
	 *                 maximum: 5000
	 *                 description: Rows per batch job. Defaults to 100.
	 *     responses:
	 *       '202':
	 *         description: Planner job accepted.
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
	 * /v1/admin/jobs/date-backfill/pause:
	 *   post:
	 *     summary: Pause the date-backfill queue
	 *     description: |
	 *       Queue-level pause: workers stop accepting new jobs but in-flight
	 *       jobs finish their current row batch. There is no per-job pause
	 *       in BullMQ.
	 *     operationId: pauseDateBackfill
	 *     tags:
	 *       - Admin / Date Backfill
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '204':
	 *         description: Queue paused.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post(
		'/pause',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		controller.pause
	);

	/**
	 * @openapi
	 * /v1/admin/jobs/date-backfill/resume:
	 *   post:
	 *     summary: Resume the date-backfill queue
	 *     description: Mirror of `/pause`.
	 *     operationId: resumeDateBackfill
	 *     tags:
	 *       - Admin / Date Backfill
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '204':
	 *         description: Queue resumed.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post(
		'/resume',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		controller.resume
	);

	/**
	 * @openapi
	 * /v1/admin/jobs/date-backfill/{jobId}/status:
	 *   get:
	 *     summary: Get the status of a date-backfill planner job
	 *     description: |
	 *       Returns the planner's BullMQ state collapsed into a 5-state
	 *       contract (`pending` | `running` | `paused` | `completed` |
	 *       `failed`) plus the live counters (total / scanned / updated /
	 *       failed) accumulated by the spawned batch jobs.
	 *
	 *       A planner is reported as `running` whenever the scanned counter
	 *       hasn't yet caught up with total, even if its own BullMQ state is
	 *       `completed` (the orchestrator finished enqueueing but batches are
	 *       still in flight).
	 *     operationId: getDateBackfillStatus
	 *     tags:
	 *       - Admin / Date Backfill
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
	 *         description: Current job state and counters.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/BackfillStatus'
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
		'/:jobId/status',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		controller.status
	);

	return router;
};
