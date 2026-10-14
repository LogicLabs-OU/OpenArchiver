import { Router } from 'express';
import * as settingsController from '../controllers/settings.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createSettingsRouter = (authService: AuthService): Router => {
	const router = Router();

	/**
	 * @openapi
	 * /v1/settings/system:
	 *   get:
	 *     summary: Get system settings
	 *     description: >
	 *       Returns the public system settings: language, theme, support email and date format.
	 *       No authentication is required, and nothing else from the settings record is ever included.
	 *     operationId: getSystemSettings
	 *     tags:
	 *       - Settings
	 *     responses:
	 *       '200':
	 *         description: Current system settings.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/SystemSettings'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 *   put:
	 *     summary: Update system settings
	 *     description: Updates the public system settings. Only `language`, `theme`, `supportEmail` and `dateFormat` are accepted; any other key is ignored. Requires `manage:settings` permission.
	 *     operationId: updateSystemSettings
	 *     tags:
	 *       - Settings
	 *     security:
	 *       - bearerAuth: []
	 *       - apiKeyAuth: []
	 *     requestBody:
	 *       required: true
	 *       content:
	 *         application/json:
	 *           schema:
	 *             $ref: '#/components/schemas/SystemSettings'
	 *     responses:
	 *       '200':
	 *         description: Updated system settings.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/SystemSettings'
	 *       '401':
	 *         $ref: '#/components/responses/Unauthorized'
	 *       '403':
	 *         $ref: '#/components/responses/Forbidden'
	 *       '422':
	 *         description: A field has an invalid value (unknown language, theme or date format, or a malformed support email). `errors` lists the fields.
	 *         content:
	 *           application/json:
	 *             schema:
	 *               $ref: '#/components/schemas/ErrorMessage'
	 *       '500':
	 *         $ref: '#/components/responses/InternalServerError'
	 */
	// Public route to get non-sensitive settings. All end users need the settings data in the frontend.
	router.get('/system', settingsController.getSystemSettings);

	// Protected route to update settings
	router.put(
		'/system',
		requireAuth(authService),
		requirePermission('manage', 'settings', 'settings.noPermissionToUpdate'),
		settingsController.updateSystemSettings
	);

	return router;
};
