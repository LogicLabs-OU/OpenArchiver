import { Router } from 'express';
import { ArchivedEmailController } from '../controllers/archived-email.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createArchivedEmailRouter = (
	archivedEmailController: ArchivedEmailController,
	authService: AuthService
): Router => {
	const router = Router();

	// Secure all routes in this module
	router.use(requireAuth(authService));

	router.get('/ingestion-source/:ingestionSourceId', archivedEmailController.getArchivedEmails);

	router.get(
		'/:id',
		requirePermission('archive:read', 'archive/all'),
		archivedEmailController.getArchivedEmailById
	);

	router.delete(
		'/:id',
		requirePermission('archive:write', 'archive/all'),
		archivedEmailController.deleteArchivedEmail
	);

	return router;
};
