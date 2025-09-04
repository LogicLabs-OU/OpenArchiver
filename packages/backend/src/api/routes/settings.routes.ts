import { Router } from 'express';
import * as settingsController from '../controllers/settings.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createSettingsRouter = (authService: AuthService): Router => {
	const router = Router();

	// Public route to get non-sensitive settings.  settings read should not be scoped with a permission because all end users need the settings data in the frontend. However, for sensitive settings data, we need to add a new permission subject to limit access. So this route should only expose non-sensitive settings data.
	/**
	 * @returns SystemSettings
	 */
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
