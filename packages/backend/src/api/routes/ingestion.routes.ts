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

	router.post(
		'/',
		requirePermission('ingestion:create', 'ingestion-source/*'),
		ingestionController.create
	);

	router.get('/', ingestionController.findAll);

	router.get(
		'/:id',
		requirePermission('ingestion:read', 'ingestion-source/{sourceId}'),
		ingestionController.findById
	);

	router.put(
		'/:id',
		requirePermission('ingestion:update', 'ingestion-source/{sourceId}'),
		ingestionController.update
	);

	router.delete(
		'/:id',
		requirePermission('ingestion:delete', 'ingestion-source/{sourceId}'),
		ingestionController.delete
	);

	router.post(
		'/:id/import',
		requirePermission('ingestion:manage', 'ingestion-source/{sourceId}'),
		ingestionController.triggerInitialImport
	);

	router.post(
		'/:id/pause',
		requirePermission('ingestion:manage', 'ingestion-source/{sourceId}'),
		ingestionController.pause
	);

	router.post(
		'/:id/sync',
		requirePermission('ingestion:manage', 'ingestion-source/{sourceId}'),
		ingestionController.triggerForceSync
	);

	return router;
};
