import { Router } from 'express';
import { IngestionController } from '../controllers/ingestion.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission, ingestionResource } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createIngestionRouter = (
	ingestionController: IngestionController,
	authService: AuthService
): Router => {
	const router = Router();

	// Secure all routes in this module
	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/ingestion-sources:
	 *   post:
	 *     summary: Create an ingestion source
	 *     description: Creates a new ingestion source and validates the connection. Returns the created source without credentials. Requires `create:ingestion` permission.
	 *     operationId: createIngestionSource
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             $ref: '#/components/schemas/CreateIngestionSourceDto'
	 *     responses:
	 *       '201':
	 *         description: Ingestion source created successfully.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/SafeIngestionSource'
	 *       '400':
	 *         description: Invalid input or connection test failed.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *   get:
	 *     summary: List ingestion sources
	 *     description: Returns all ingestion sources accessible to the authenticated user. Credentials are excluded from the response. Requires `read:ingestion` permission.
	 *     operationId: listIngestionSources
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: Array of ingestion sources.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 $ref: '#/components/schemas/SafeIngestionSource'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post('/', requirePermission('create', 'ingestion'), ingestionController.create);

	router.get('/', requirePermission('read', 'ingestion'), ingestionController.findAll);

	/**
	 * @openapi
	 * /v1/ingestion-sources/reindex-all:
	 *   post:
	 *     summary: Reindex the entire archive
	 *     description: Enqueues a reindex of every ingestion source. Rebuilds search documents from existing archived emails without re-ingesting. Requires `manage:ingestion` permission.
	 *     operationId: reindexAllIngestionSources
	 *     tags:
	 *       - Ingestion
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
	 *               mode:
	 *                 type: string
	 *                 enum: [missing, full]
	 *     responses:
	 *       '202':
	 *         description: Reindex job accepted and queued.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 */
	router.post(
		'/reindex-all',
		requirePermission('manage', 'ingestion'),
		ingestionController.reindexAll
	);

	// Withheld from the API reference while the feature is held back: the endpoints answer 503
	// (see IngestionController.DUPLICATE_CLEANUP_ENABLED). The @openapi blocks were removed so
	// the generated spec does not advertise them; restore them when the feature ships.
	router.get(
		'/duplicates',
		requirePermission('manage', 'ingestion'),
		ingestionController.getDuplicateCount
	);

	router.post(
		'/duplicates/cleanup',
		requirePermission('manage', 'ingestion'),
		ingestionController.cleanupDuplicates
	);

	/**
	 * @openapi
	 * /v1/ingestion-sources/{id}:
	 *   get:
	 *     summary: Get an ingestion source
	 *     description: Returns a single ingestion source by ID. Credentials are excluded. Requires `read:ingestion` permission.
	 *     operationId: getIngestionSourceById
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *           example: "clx1y2z3a0000b4d2"
	 *     responses:
	 *       '200':
	 *         description: Ingestion source details.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/SafeIngestionSource'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 *   put:
	 *     summary: Update an ingestion source
	 *     description: Updates configuration for an existing ingestion source. Requires `update:ingestion` permission.
	 *     operationId: updateIngestionSource
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *           example: "clx1y2z3a0000b4d2"
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             $ref: '#/components/schemas/UpdateIngestionSourceDto'
	 *     responses:
	 *       '200':
	 *         description: Updated ingestion source.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/SafeIngestionSource'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 *   delete:
	 *     summary: Delete an ingestion source
	 *     description: Permanently deletes an ingestion source. Deletion must be enabled in system settings. Requires `delete:ingestion` permission.
	 *     operationId: deleteIngestionSource
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *           example: "clx1y2z3a0000b4d2"
	 *     responses:
	 *       '204':
	 *         description: Ingestion source deleted. No content returned.
	 *       '400':
	 *         description: Deletion disabled or constraint error.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get(
		'/:id',
		requirePermission('read', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.findById
	);

	router.put(
		'/:id',
		requirePermission('update', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.update
	);

	router.delete(
		'/:id',
		requirePermission('delete', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.delete
	);

	/**
	 * @openapi
	 * /v1/ingestion-sources/{id}/import:
	 *   post:
	 *     summary: Trigger initial import
	 *     description: Enqueues an initial import job for the ingestion source. This imports all historical emails. Requires `create:ingestion` permission.
	 *     operationId: triggerInitialImport
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *           example: "clx1y2z3a0000b4d2"
	 *     responses:
	 *       '202':
	 *         description: Initial import job accepted and queued.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/MessageResponse'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post(
		'/:id/import',
		// `sync`, not `create`: this re-runs the import for a source that already exists. An
		// unconditional `create ingestion` rule (held by the End user role) would otherwise match
		// every source and defeat the record check below.
		requirePermission('sync', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.triggerInitialImport
	);

	/**
	 * @openapi
	 * /v1/ingestion-sources/{id}/pause:
	 *   post:
	 *     summary: Pause an ingestion source
	 *     description: Sets the ingestion source status to `paused`, stopping continuous sync. Requires `update:ingestion` permission.
	 *     operationId: pauseIngestionSource
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *           example: "clx1y2z3a0000b4d2"
	 *     responses:
	 *       '200':
	 *         description: Ingestion source paused. Returns the updated source.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/SafeIngestionSource'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post(
		'/:id/pause',
		requirePermission('update', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.pause
	);

	/**
	 * @openapi
	 * /v1/ingestion-sources/{id}/sync:
	 *   post:
	 *     summary: Force sync
	 *     description: Triggers an out-of-schedule continuous sync for the ingestion source. Requires `sync:ingestion` permission.
	 *     operationId: triggerForceSync
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *           example: "clx1y2z3a0000b4d2"
	 *     responses:
	 *       '202':
	 *         description: Force sync job accepted and queued.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/MessageResponse'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post(
		'/:id/sync',
		requirePermission('sync', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.triggerForceSync
	);

	/**
	 * @openapi
	 * /v1/ingestion-sources/{id}/reindex:
	 *   post:
	 *     summary: Reindex an ingestion source
	 *     description: Enqueues a reindex of the source (and its merge group). Rebuilds search documents from existing archived emails without re-ingesting or duplicating. Requires `sync:ingestion` permission.
	 *     operationId: reindexIngestionSource
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *     requestBody:
	 *       required: false
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               mode:
	 *                 type: string
	 *                 enum: [missing, full]
	 *     responses:
	 *       '202':
	 *         description: Reindex job accepted and queued.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 */
	router.post(
		'/:id/reindex',
		requirePermission('sync', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.reindex
	);

	/**
	 * @openapi
	 * /v1/ingestion-sources/{id}/index-health:
	 *   get:
	 *     summary: Get index health for a source
	 *     description: Returns the number of archived emails vs. indexed documents for the source (and its merge group). Requires `read:ingestion` permission.
	 *     operationId: getIngestionSourceIndexHealth
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *     responses:
	 *       '200':
	 *         description: Index health snapshot.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 archivedCount:
	 *                   type: integer
	 *                 indexedCount:
	 *                   type: integer
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 */
	router.get(
		'/:id/index-health',
		requirePermission('read', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.getIndexHealth
	);

	/**
	 * @openapi
	 * /v1/ingestion-sources/{id}/stats:
	 *   get:
	 *     summary: Get statistics for a source
	 *     description: Returns read-only statistics for the source (and its merge group) — email/mailbox/thread counts, storage usage, index coverage, attachment/compliance counts, per-mailbox breakdown, merge-group children, and recent activity. Requires `read:ingestion` permission.
	 *     operationId: getIngestionSourceStats
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *     responses:
	 *       '200':
	 *         description: Ingestion source statistics.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 */
	router.get(
		'/:id/stats',
		requirePermission('read', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.getStats
	);

	/**
	 * @openapi
	 * /v1/ingestion-sources/{id}/unmerge:
	 *   post:
	 *     summary: Unmerge a child ingestion source
	 *     description: Detaches a child source from its merge group, making it a standalone root source. Requires `update:ingestion` permission.
	 *     operationId: unmergeIngestionSource
	 *     tags:
	 *       - Ingestion
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         schema:
	 *           type: string
	 *     responses:
	 *       '200':
	 *         description: Source unmerged. Returns the updated source.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/SafeIngestionSource'
	 *       '400':
	 *         description: Source is not merged into another source.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 */
	router.post(
		'/:id/unmerge',
		requirePermission('update', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.unmerge
	);

	// Withheld from the API reference while the feature is held back: the endpoints answer 503
	// (see IngestionController.DUPLICATE_CLEANUP_ENABLED). The @openapi blocks were removed so
	// the generated spec does not advertise them; restore them when the feature ships.
	router.get(
		'/:id/duplicates',
		requirePermission('read', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.getDuplicateCount
	);

	router.post(
		'/:id/duplicates/cleanup',
		requirePermission('delete', 'ingestion', { loadResource: ingestionResource }),
		ingestionController.cleanupDuplicates
	);

	return router;
};
