import { Router } from 'express';
import { IntegrityController } from '../controllers/integrity.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const integrityRoutes = (authService: AuthService): Router => {
	const router = Router();
	const controller = new IntegrityController();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/integrity/{id}:
	 *   get:
	 *     summary: Check email integrity
	 *     description: Verifies the SHA-256 hash of an archived email and all its attachments against the hashes stored at archival time. Returns per-item integrity results. Requires `read:archive` permission.
	 *     operationId: checkIntegrity
	 *     tags:
	 *       - Integrity
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     parameters:
	 *       - name: id
	 *         in: path
	 *         required: true
	 *         description: UUID of the archived email to verify.
	 *         schema:
	 *           type: string
	 *           format: uuid
	 *           example: "550e8400-e29b-41d4-a716-446655440000"
	 *     responses:
	 *       '200':
	 *         description: Integrity check results for the email and its attachments.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 $ref: '#/components/schemas/IntegrityCheckResult'
	 *       '400':
	 *         description: Invalid UUID format.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ValidationError'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get('/:id', requirePermission('read', 'archive'), controller.checkIntegrity);

	return router;
};
