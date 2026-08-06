import { Router } from 'express';
import type { AuthController } from '../controllers/auth.controller';

export const createAuthRouter = (authController: AuthController): Router => {
	const router = Router();

	/**
	 * @openapi
	 * /v1/auth/setup:
	 *   post:
	 *     summary: Initial setup
	 *     description: Creates the initial administrator user. Can only be called once when no users exist.
	 *     operationId: authSetup
	 *     tags:
	 *       - Auth
	 *     security: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - email
	 *               - password
	 *               - first_name
	 *               - last_name
	 *             properties:
	 *               email:
	 *                 type: string
	 *                 format: email
	 *                 example: admin@example.com
	 *               password:
	 *                 type: string
	 *                 format: password
	 *                 example: "securepassword123"
	 *               first_name:
	 *                 type: string
	 *                 example: Admin
	 *               last_name:
	 *                 type: string
	 *                 example: User
	 *     responses:
	 *       '201':
	 *         description: Admin user created and logged in successfully.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/LoginResponse'
	 *       '400':
	 *         description: All fields are required.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '403':
	 *         description: Setup has already been completed (users already exist).
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post('/setup', authController.setup);

	/**
	 * @openapi
	 * /v1/auth/login:
	 *   post:
	 *     summary: Login
	 *     description: Authenticates a user with email and password and returns a JWT access token.
	 *     operationId: authLogin
	 *     tags:
	 *       - Auth
	 *     security: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             type: object
	 *             required:
	 *               - email
	 *               - password
	 *             properties:
	 *               email:
	 *                 type: string
	 *                 format: email
	 *                 example: user@example.com
	 *               password:
	 *                 type: string
	 *                 format: password
	 *                 example: "securepassword123"
	 *     responses:
	 *       '200':
	 *         description: Authentication successful.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/LoginResponse'
	 *       '400':
	 *         description: Email and password are required.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '401':
	 *         description: Invalid credentials.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.post('/login', authController.login);

	/**
	 * @openapi
	 * /v1/auth/status:
	 *   get:
	 *     summary: Check setup status
	 *     description: Returns whether the application has been set up (i.e., whether an admin user exists).
	 *     operationId: authStatus
	 *     tags:
	 *       - Auth
	 *     security: []
	 *     responses:
	 *       '200':
	 *         description: Setup status returned.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               type: object
	 *               properties:
	 *                 needsSetup:
	 *                   type: boolean
	 *                   description: True if no admin user exists and setup is required.
	 *                   example: false
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	router.get('/status', authController.status);

	return router;
};
