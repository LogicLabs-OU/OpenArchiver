import { Router } from 'express';
import { ApiKeyController } from '../controllers/api-key.controller';
import { requireAuth } from '../middleware/requireAuth';
import { AuthService } from '../../services/AuthService';

export const apiKeyRoutes = (authService: AuthService): Router => {
	const router = Router();
	const controller = new ApiKeyController();

	/**
	 * @openapi
	 * /v1/api-keys:
	 *   post:
	 *     summary: Generate an API key
	 *     description: >
	 *       Generates a new API key for the authenticated user. The raw key value is only returned once at creation time.
	 *       The key name must be between 1–255 characters. Expiry is required and must be within 730 days (2 years).
	 *       Disabled in demo mode.
	 *     operationId: generateApiKey
	 *     tags:
	 *       - API Keys
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
	 *               - name
	 *               - expiresInDays
	 *             properties:
	 *               name:
	 *                 type: string
	 *                 minLength: 1
	 *                 maxLength: 255
	 *                 example: "CI/CD Pipeline Key"
	 *               expiresInDays:
	 *                 type: integer
	 *                 minimum: 1
	 *                 maximum: 730
	 *                 example: 90
	 *     responses:
	 *       '201':
	 *         description: API key created. The raw `key` value is only shown once.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 key:
	 *                   type: string
	 *                   description: The raw API key. Store this securely — it will not be shown again.
	 *                   example: "oa_live_abc123..."
	 *       '400':
	 *         description: Validation error (name too short/long, expiry out of range).
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ValidationError'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         description: Disabled in demo mode.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 *   get:
	 *     summary: List API keys
	 *     description: Returns all API keys belonging to the currently authenticated user. The raw key value is not included.
	 *     operationId: getApiKeys
	 *     tags:
	 *       - API Keys
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: List of API keys (without raw key values).
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 $ref: '#/components/schemas/ApiKey'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 */
	router.post('/', requireAuth(authService), controller.generateApiKey);
	router.get('/', requireAuth(authService), controller.getApiKeys);

	/**
	 * @openapi
	 * /v1/api-keys/{id}:
	 *   delete:
	 *     summary: Delete an API key
	 *     description: Permanently revokes and deletes an API key by ID. Only the owning user can delete their own keys. Disabled in demo mode.
	 *     operationId: deleteApiKey
	 *     tags:
	 *       - API Keys
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         description: The ID of the API key to delete.
	 *         schema:
	 *           type: string
	 *           example: "clx1y2z3a0000b4d2"
	 *     responses:
	 *       '204':
	 *         description: API key deleted. No content returned.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         description: Disabled in demo mode.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.delete('/:id', requireAuth(authService), controller.deleteApiKey);

	return router;
};
