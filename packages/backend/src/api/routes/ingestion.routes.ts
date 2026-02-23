import { Router } from 'express';
import { IngestionController } from '../controllers/ingestion.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createIngestionRouter = (
	ingestionController: IngestionController,
	authService: AuthService
): Router => {
	const router = Router();

	// Secure all routes in this module
	router.use(requireAuth(authService));

	router.post('/', requirePermission('create', 'ingestion'), ingestionController.create);

	router.get('/', requirePermission('read', 'ingestion'), ingestionController.findAll);

	router.get('/:id', requirePermission('read', 'ingestion'), ingestionController.findById);

	router.put('/:id', requirePermission('update', 'ingestion'), ingestionController.update);

	router.delete('/:id', requirePermission('delete', 'ingestion'), ingestionController.delete);

	router.post(
		'/:id/import',
		requirePermission('create', 'ingestion'),
		ingestionController.triggerInitialImport
	);

	router.post('/:id/pause', requirePermission('update', 'ingestion'), ingestionController.pause);

	router.post(
		'/:id/sync',
		requirePermission('sync', 'ingestion'),
		ingestionController.triggerForceSync
	);

	// Outlook Personal OAuth routes
	router.get(
		'/oauth/outlook-personal/authorize',
		requirePermission('create', 'ingestion'),
		ingestionController.outlookPersonalAuthorize
	);

	router.post(
		'/oauth/outlook-personal/callback',
		requirePermission('create', 'ingestion'),
		ingestionController.outlookPersonalCallback
	);

	return router;
};
