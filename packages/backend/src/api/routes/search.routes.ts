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
	 *     description: Performs a full-text search across indexed archived emails using Meilisearch, with optional advanced filters. List-valued parameters accept comma-separated values; list values are OR-combined within a parameter and AND-combined across parameters. Requires `search:archive` permission.
	 *     operationId: searchEmails
	 *     tags:
	 *       - Search
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: keywords
	 *         in: query
	 *         required: false
	 *         description: The search query string. Required unless at least one filter parameter is provided (filter-only browsing).
	 *         schema:
	 *           type: string
	 *           example: "invoice Q4"
	 *       - name: sources
	 *         in: query
	 *         required: false
	 *         description: Comma-separated ingestion source IDs to include. Each ID is expanded to its full merge group.
	 *         schema:
	 *           type: string
	 *           example: "3f6e…a1,9c2b…e7"
	 *       - name: excludeSources
	 *         in: query
	 *         required: false
	 *         description: Comma-separated ingestion source IDs to exclude. Each ID is expanded to its full merge group.
	 *         schema:
	 *           type: string
	 *       - name: from
	 *         in: query
	 *         required: false
	 *         description: Comma-separated sender addresses to include.
	 *         schema:
	 *           type: string
	 *           example: "alice@example.com,bob@example.com"
	 *       - name: notFrom
	 *         in: query
	 *         required: false
	 *         description: Comma-separated sender addresses to exclude.
	 *         schema:
	 *           type: string
	 *       - name: to
	 *         in: query
	 *         required: false
	 *         description: Comma-separated recipient addresses to include. Matches the To, Cc, or Bcc field.
	 *         schema:
	 *           type: string
	 *       - name: notTo
	 *         in: query
	 *         required: false
	 *         description: Comma-separated recipient addresses to exclude from To, Cc, and Bcc.
	 *         schema:
	 *           type: string
	 *       - name: mailboxes
	 *         in: query
	 *         required: false
	 *         description: Comma-separated mailbox owner addresses (the account an email was archived from).
	 *         schema:
	 *           type: string
	 *       - name: dateFrom
	 *         in: query
	 *         required: false
	 *         description: Inclusive start date (UTC), yyyy-mm-dd.
	 *         schema:
	 *           type: string
	 *           format: date
	 *           example: "2025-01-01"
	 *       - name: dateTo
	 *         in: query
	 *         required: false
	 *         description: Inclusive end date (UTC), yyyy-mm-dd.
	 *         schema:
	 *           type: string
	 *           format: date
	 *           example: "2025-12-31"
	 *       - name: searchIn
	 *         in: query
	 *         required: false
	 *         description: Comma-separated parts of the email to match keywords against. Any of `subject`, `body`, `attachment_name`, `attachment_content`, `from`, `to`. Omitted = search everywhere.
	 *         schema:
	 *           type: string
	 *           example: "subject,attachment_name"
	 *       - name: hasAttachments
	 *         in: query
	 *         required: false
	 *         description: Filter by attachment presence. Emails indexed before this field existed count as attachment-less until reindexed.
	 *         schema:
	 *           type: boolean
	 *       - name: sort
	 *         in: query
	 *         required: false
	 *         description: Result ordering. `date_desc` (default) and `date_asc` sort by sent date; `relevance` uses Meilisearch ranking.
	 *         schema:
	 *           type: string
	 *           enum: [relevance, date_desc, date_asc]
	 *           default: date_desc
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
	 *         description: Missing keywords (with no filters) or an invalid filter parameter.
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

	/**
	 * @openapi
	 * /v1/search/facets:
	 *   get:
	 *     summary: Suggest facet values (typeahead)
	 *     description: Returns prefix-matched, permission-scoped distinct values for a facet field, for autocomplete inputs such as the mailbox filter. Requires `search:archive` permission.
	 *     operationId: searchFacetValues
	 *     tags:
	 *       - Search
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: field
	 *         in: query
	 *         required: true
	 *         description: The facet field to suggest values for.
	 *         schema:
	 *           type: string
	 *           enum: [mailboxes, from]
	 *       - name: query
	 *         in: query
	 *         required: false
	 *         description: The partial value typed so far; empty returns the most common values.
	 *         schema:
	 *           type: string
	 *           example: "ali"
	 *     responses:
	 *       '200':
	 *         description: Matching facet values.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 values:
	 *                   type: array
	 *                   items:
	 *                     type: string
	 *                   example: ["alice@example.com", "alan@example.com"]
	 *       '400':
	 *         description: Unknown or missing field.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get('/facets', requirePermission('search', 'archive'), searchController.facets);

	return router;
};
