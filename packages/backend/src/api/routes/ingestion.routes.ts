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
		requirePermission('ingestion:createSource', 'ingestion-source/*'),
		ingestionController.create
	);

	router.get('/', ingestionController.findAll);

	router.get(
		'/:id',
		requirePermission('ingestion:readSource', 'ingestion-source/{sourceId}'),
		ingestionController.findById
	);

	router.put(
		'/:id',
		requirePermission('ingestion:updateSource', 'ingestion-source/{sourceId}'),
		ingestionController.update
	);

	router.delete(
		'/:id',
		requirePermission('ingestion:deleteSource', 'ingestion-source/{sourceId}'),
		ingestionController.delete
	);

	router.post(
		'/:id/import',
		requirePermission('ingestion:manageSync', 'ingestion-source/{sourceId}'),
		ingestionController.triggerInitialImport
	);

	router.post(
		'/:id/pause',
		requirePermission('ingestion:manageSync', 'ingestion-source/{sourceId}'),
		ingestionController.pause
	);

	router.post(
		'/:id/sync',
		requirePermission('ingestion:manageSync', 'ingestion-source/{sourceId}'),
		ingestionController.triggerForceSync
	);

	return router;
};
