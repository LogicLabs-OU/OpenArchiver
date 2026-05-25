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
	 *     summary: Search archived emails (deprecated — use POST)
	 *     deprecated: true
	 *     description: |
	 *       Backwards-compatible keyword-only search shim. Prefer `POST /v1/search`
	 *       for typed filters, sort, and filter-only queries.
	 *       Responses include `Deprecation: true` and an RFC 8594 `Sunset` header.
	 *       Requires `search:archive` permission.
	 *     operationId: searchEmailsLegacy
	 *     tags:
	 *       - Search
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: keywords
	 *         in: query
	 *         required: false
	 *         description: The search query string. May be omitted for a filter-only search.
	 *         schema:
	 *           type: string
	 *           example: "invoice Q4"
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
	 *       - name: matchingStrategy
	 *         in: query
	 *         required: false
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
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 *   post:
	 *     summary: Search archived emails
	 *     description: |
	 *       Full-text + typed-filter search. The request body accepts an optional
	 *       `query` (keywords), an optional `filters` object whose shape is the
	 *       `SearchFilters` type in `@open-archiver/types`, optional `sort`,
	 *       and standard pagination. Requires `search:archive` permission.
	 *     operationId: searchEmails
	 *     tags:
	 *       - Search
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     requestBody:
	 *       required: false
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             additionalProperties: false
	 *             properties:
	 *               query:
	 *                 type: string
	 *                 description: Optional keyword string. Omit or pass an empty string for a filter-only search.
	 *                 example: "invoice Q4"
	 *               filters:
	 *                 type: object
	 *                 description: |
	 *                   Typed filter object. Each field accepts a `{op, value}`
	 *                   clause; `ingestionSourceId` also accepts a bare string
	 *                   shorthand. Unknown fields → 400. P3-gated fields
	 *                   (`path`, `tags`, `hasAttachments`, `sizeBytes`,
	 *                   `isOnLegalHold`, `threadId`, `attachments.sha256`,
	 *                   `subject`) are rejected until the index is extended.
	 *                 additionalProperties: false
	 *                 properties:
	 *                   from: { type: object }
	 *                   to: { type: object }
	 *                   cc: { type: object }
	 *                   bcc: { type: object }
	 *                   subject: { type: object }
	 *                   timestamp: { type: object }
	 *                   ingestionSourceId: {}
	 *                   userEmail: { type: object }
	 *                   path: { type: object }
	 *                   hasAttachments: {}
	 *                   tags: { type: object }
	 *                   sizeBytes: { type: object }
	 *                   isOnLegalHold: {}
	 *                   threadId: { type: object }
	 *                   attachments: { type: object }
	 *               sort:
	 *                 type: array
	 *                 items:
	 *                   type: object
	 *                   required: [field, dir]
	 *                   properties:
	 *                     field:
	 *                       type: string
	 *                       enum: [timestamp]
	 *                     dir:
	 *                       type: string
	 *                       enum: [asc, desc]
	 *               page:
	 *                 type: integer
	 *                 minimum: 1
	 *                 default: 1
	 *               limit:
	 *                 type: integer
	 *                 minimum: 1
	 *                 maximum: 100
	 *                 default: 10
	 *               matchingStrategy:
	 *                 type: string
	 *                 enum: [last, all, frequency]
	 *                 default: last
	 *           examples:
	 *             keywordOnly:
	 *               summary: Keyword search
	 *               value:
	 *                 query: "invoice Q4"
	 *             filterOnly:
	 *               summary: Filter-only (no keyword)
	 *               value:
	 *                 filters:
	 *                   from: { op: contains, value: "@acme.com" }
	 *                   timestamp:
	 *                     op: between
	 *                     value: ["2025-01-01T00:00:00Z", "2025-04-01T00:00:00Z"]
	 *             mixed:
	 *               summary: Keyword + filter + sort
	 *               value:
	 *                 query: "invoice"
	 *                 filters:
	 *                   from: { op: eq, value: "billing@acme.com" }
	 *                 sort: [{ field: timestamp, dir: asc }]
	 *                 page: 1
	 *                 limit: 25
	 *     responses:
	 *       '200':
	 *         description: Search results.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/SearchResults'
	 *       '400':
	 *         description: Validation error or invalid filter.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 message:
	 *                   type: string
	 *                 field:
	 *                   type: string
	 *                 reason:
	 *                   type: string
	 *                 errors:
	 *                   type: array
	 *                   items:
	 *                     type: object
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get('/', requirePermission('search', 'archive'), searchController.searchGet);
	router.post('/', requirePermission('search', 'archive'), searchController.searchPost);

	return router;
};
