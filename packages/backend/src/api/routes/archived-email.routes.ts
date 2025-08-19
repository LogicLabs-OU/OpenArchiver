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

	router.get(
		'/ingestion-source/:ingestionSourceId',
		requirePermission('read', 'archive'),
		archivedEmailController.getArchivedEmails
	);

	router.get(
		'/:id',
		requirePermission('read', 'archive'),
		archivedEmailController.getArchivedEmailById
	);

	router.delete(
		'/:id',
		requirePermission('delete', 'archive'),
		archivedEmailController.deleteArchivedEmail
	);

	return router;
};
