import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createUserRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	/**
	 * @openapi
	 * /v1/users:
	 *   get:
	 *     summary: List all users
	 *     description: Returns all user accounts in the system. Requires `read:users` permission.
	 *     operationId: getUsers
	 *     tags:
	 *       - Users
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: List of users.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: array
	 *               items:
	 *                 $ref: '#/components/schemas/User'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 */
	router.get('/', requirePermission('read', 'users'), userController.getUsers);

	/**
	 * @openapi
	 * /v1/users/profile:
	 *   get:
	 *     summary: Get current user profile
	 *     description: Returns the profile of the currently authenticated user.
	 *     operationId: getProfile
	 *     tags:
	 *       - Users
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     responses:
	 *       '200':
	 *         description: Current user's profile.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/User'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 *   patch:
	 *     summary: Update current user profile
	 *     description: Updates the email, first name, or last name of the currently authenticated user. Disabled in demo mode.
	 *     operationId: updateProfile
	 *     tags:
	 *       - Users
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             properties:
	 *               email:
	 *                 type: string
	 *                 format: email
	 *               first_name:
	 *                 type: string
	 *               last_name:
	 *                 type: string
	 *     responses:
	 *       '200':
	 *         description: Updated user profile.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/User'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         description: Disabled in demo mode.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 */
	router.get('/profile', userController.getProfile);
	router.patch('/profile', userController.updateProfile);

	/**
	 * @openapi
	 * /v1/users/profile/password:
	 *   post:
	 *     summary: Update password
	 *     description: Updates the password of the currently authenticated user. The current password must be provided for verification. Disabled in demo mode.
	 *     operationId: updatePassword
	 *     tags:
	 *       - Users
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
	 *               - currentPassword
	 *               - newPassword
	 *             properties:
	 *               currentPassword:
	 *                 type: string
	 *                 format: password
	 *               newPassword:
	 *                 type: string
	 *                 format: password
	 *     responses:
	 *       '200':
	 *         description: Password updated successfully.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/MessageResponse'
	 *       '400':
	 *         description: Current password is incorrect.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         description: Disabled in demo mode.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 */
	router.post('/profile/password', userController.updatePassword);

	/**
	 * @openapi
	 * /v1/users/{id}:
	 *   get:
	 *     summary: Get a user
	 *     description: Returns a single user by ID. Requires `read:users` permission.
	 *     operationId: getUser
	 *     tags:
	 *       - Users
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
	 *         description: User details.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/User'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 */
	router.get('/:id', requirePermission('read', 'users'), userController.getUser);

	/**
	 * @openapi
	 * /v1/users:
	 *   post:
	 *     summary: Create a user
	 *     description: Creates a new user account and optionally assigns a role. Requires `manage:all` (Super Admin) permission.
	 *     operationId: createUser
	 *     tags:
	 *       - Users
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
	 *               - email
	 *               - first_name
	 *               - last_name
	 *               - password
	 *             properties:
	 *               email:
	 *                 type: string
	 *                 format: email
	 *                 example: jane.doe@example.com
	 *               first_name:
	 *                 type: string
	 *                 example: Jane
	 *               last_name:
	 *                 type: string
	 *                 example: Doe
	 *               password:
	 *                 type: string
	 *                 format: password
	 *                 example: "securepassword123"
	 *               roleId:
	 *                 type: string
	 *                 description: Optional role ID to assign to the user.
	 *                 example: "clx1y2z3a0000b4d2"
	 *     responses:
	 *       '201':
	 *         description: User created.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/User'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.post(
		'/',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		userController.createUser
	);

	/**
	 * @openapi
	 * /v1/users/{id}:
	 *   put:
	 *     summary: Update a user
	 *     description: Updates a user's email, name, or role assignment. Requires `manage:all` (Super Admin) permission.
	 *     operationId: updateUser
	 *     tags:
	 *       - Users
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
	 *               email:
	 *                 type: string
	 *                 format: email
	 *               first_name:
	 *                 type: string
	 *               last_name:
	 *                 type: string
	 *               roleId:
	 *                 type: string
	 *     responses:
	 *       '200':
	 *         description: Updated user.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/User'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '404':
	 *         $ref: '#/components/responses/NotFound'
	 */
	router.put(
		'/:id',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		userController.updateUser
	);

	/**
	 * @openapi
	 * /v1/users/{id}:
	 *   delete:
	 *     summary: Delete a user
	 *     description: Permanently deletes a user. Cannot delete the last remaining user. Requires `manage:all` (Super Admin) permission.
	 *     operationId: deleteUser
	 *     tags:
	 *       - Users
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
	 *         description: User deleted. No content returned.
	 *       '400':
	 *         description: Cannot delete the only remaining user.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 */
	router.delete(
		'/:id',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		userController.deleteUser
	);

	return router;
};
