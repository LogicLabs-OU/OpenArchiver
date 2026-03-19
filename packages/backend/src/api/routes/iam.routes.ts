import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import type { IamController } from '../controllers/iam.controller';
import type { AuthService } from '../../services/AuthService';

export const createIamRouter = (iamController: IamController, authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/iam/roles:
	 *   get:
	 *     summary: List all roles
	 *     description: Returns all IAM roles. If predefined roles do not yet exist, they are created automatically. Requires `read:roles` permission.
	 *     operationId: getRoles
	 *     tags:
	 *       - IAM
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: List of roles.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 $ref: '#/components/schemas/Role'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get('/roles', requirePermission('read', 'roles'), iamController.getRoles);

	/**
	 * @openapi
	 * /v1/iam/roles/{id}:
	 *   get:
	 *     summary: Get a role
	 *     description: Returns a single IAM role by ID. Requires `read:roles` permission.
	 *     operationId: getRoleById
	 *     tags:
	 *       - IAM
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
	 *         description: Role details.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/Role'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get('/roles/:id', requirePermission('read', 'roles'), iamController.getRoleById);

	/**
	 * @openapi
	 * /v1/iam/roles:
	 *   post:
	 *     summary: Create a role
	 *     description: Creates a new IAM role with the given name and CASL policies. Requires `manage:all` (Super Admin) permission.
	 *     operationId: createRole
	 *     tags:
	 *       - IAM
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
	 *               - policies
	 *             properties:
	 *               name:
	 *                 type: string
	 *                 example: "Compliance Officer"
	 *               policies:
	 *                 type: array
	 *                 items:
	 *                   $ref: '#/components/schemas/CaslPolicy'
	 *     responses:
	 *       '201':
	 *         description: Role created.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/Role'
	 *       '400':
	 *         description: Missing fields or invalid policy.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post(
		'/roles',
		requirePermission('manage', 'all', 'iam.requiresSuperAdminRole'),
		iamController.createRole
	);

	/**
	 * @openapi
	 * /v1/iam/roles/{id}:
	 *   delete:
	 *     summary: Delete a role
	 *     description: Permanently deletes an IAM role. Requires `manage:all` (Super Admin) permission.
	 *     operationId: deleteRole
	 *     tags:
	 *       - IAM
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
	 *         description: Role deleted. No content returned.
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.delete(
		'/roles/:id',
		requirePermission('manage', 'all', 'iam.requiresSuperAdminRole'),
		iamController.deleteRole
	);

	/**
	 * @openapi
	 * /v1/iam/roles/{id}:
	 *   put:
	 *     summary: Update a role
	 *     description: Updates the name or policies of an IAM role. Requires `manage:all` (Super Admin) permission.
	 *     operationId: updateRole
	 *     tags:
	 *       - IAM
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
	 *             type: object
	 *             properties:
	 *               name:
	 *                 type: string
	 *                 example: "Senior Compliance Officer"
	 *               policies:
	 *                 type: array
	 *                 items:
	 *                   $ref: '#/components/schemas/CaslPolicy'
	 *     responses:
	 *       '200':
	 *         description: Updated role.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/Role'
	 *       '400':
	 *         description: No update fields provided or invalid policy.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.put(
		'/roles/:id',
		requirePermission('manage', 'all', 'iam.requiresSuperAdminRole'),
		iamController.updateRole
	);
	return router;
};
