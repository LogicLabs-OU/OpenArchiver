import { Router } from 'express';
import { SearchController } from '../controllers/search.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createSearchRouter = (
	searchController: SearchController,
	authService: AuthService
): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/search:
	 *   get:
	 *     summary: Search archived emails
	 *     description: Performs a full-text search across indexed archived emails using Meilisearch. Requires `search:archive` permission.
	 *     operationId: searchEmails
	 *     tags:
	 *       - Search
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: keywords
	 *         in: query
	 *         required: true
	 *         description: The search query string.
	 *         schema:
	 *           type: string
	 *           example: "invoice Q4"
	 *       - name: page
	 *         in: query
	 *         required: false
	 *         description: Page number for pagination.
	 *         schema:
	 *           type: integer
	 *           default: 1
	 *           example: 1
	 *       - name: limit
	 *         in: query
	 *         required: false
	 *         description: Number of results per page.
	 *         schema:
	 *           type: integer
	 *           default: 10
	 *           example: 10
	 *       - name: matchingStrategy
	 *         in: query
	 *         required: false
	 *         description: Meilisearch matching strategy. `last` returns results containing at least one keyword; `all` requires all keywords; `frequency` sorts by keyword frequency.
	 *         schema:
	 *           type: string
	 *           enum: [last, all, frequency]
	 *           default: last
	 *     responses:
	 *       '200':
	 *         description: Search results.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/SearchResults'
	 *       '400':
	 *         description: Keywords parameter is required.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get('/', requirePermission('search', 'archive'), searchController.search);

	return router;
};
