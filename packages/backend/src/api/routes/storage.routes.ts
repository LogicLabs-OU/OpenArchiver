import { Router } from 'express';
import { StorageController } from '../controllers/storage.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createStorageRouter = (
	storageController: StorageController,
	authService: AuthService
): Router => {
	const router = Router();

	// Secure all routes in this module
	router.use(requireAuth(authService));

	router.get('/download', requirePermission('read', 'archive'), storageController.downloadFile);

	return router;
};
