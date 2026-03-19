import { Router } from 'express';
import { JobsController } from '../controllers/jobs.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createJobsRouter = (authService: AuthService): Router => {
	const router = Router();
	const jobsController = new JobsController();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/jobs/queues:
	 *   get:
	 *     summary: List all queues
	 *     description: Returns all BullMQ job queues and their current job counts broken down by status. Requires `manage:all` (Super Admin) permission.
	 *     operationId: getQueues
	 *     tags:
	 *       - Jobs
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: List of queue overviews.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 queues:
	 *                   type: array
	 *                   items:
	 *                     $ref: '#/components/schemas/QueueOverview'
	 *               example:
	 *                 queues:
	 *                   - name: ingestion
	 *                     counts:
	 *                       active: 0
	 *                       completed: 56
	 *                       failed: 4
	 *                       delayed: 3
	 *                       waiting: 0
	 *                       paused: 0
	 *                   - name: indexing
	 *                     counts:
	 *                       active: 0
	 *                       completed: 0
	 *                       failed: 0
	 *                       delayed: 0
	 *                       waiting: 0
	 *                       paused: 0
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get(
		'/queues',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		jobsController.getQueues
	);

	/**
	 * @openapi
	 * /v1/jobs/queues/{queueName}:
	 *   get:
	 *     summary: Get jobs in a queue
	 *     description: Returns a paginated list of jobs within a specific queue, filtered by status. Requires `manage:all` (Super Admin) permission.
	 *     operationId: getQueueJobs
	 *     tags:
	 *       - Jobs
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: queueName
	 *         in: path
	 *         required: true
	 *         description: The name of the queue (e.g. `ingestion` or `indexing`).
	 *         schema:
	 *           type: string
	 *           example: ingestion
	 *       - name: status
	 *         in: query
	 *         required: false
	 *         description: Filter jobs by status.
	 *         schema:
	 *           type: string
	 *           enum: [active, completed, failed, delayed, waiting, paused]
	 *           default: failed
	 *       - name: page
	 *         in: query
	 *         required: false
	 *         schema:
	 *           type: integer
	 *           default: 1
	 *       - name: limit
	 *         in: query
	 *         required: false
	 *         schema:
	 *           type: integer
	 *           default: 10
	 *     responses:
	 *       '200':
	 *         description: Detailed view of the queue including paginated jobs.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/QueueDetails'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '404':
	 *         description: Queue not found.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get(
		'/queues/:queueName',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		jobsController.getQueueJobs
	);

	return router;
};
