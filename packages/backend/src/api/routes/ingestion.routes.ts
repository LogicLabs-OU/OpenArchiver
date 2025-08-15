import { Router } from 'express';
import { IngestionController } from '../controllers/ingestion.controller';
import { requireAuth } from '../middleware/requireAuth';
import { AuthService } from '../../services/AuthService';

export const createIngestionRouter = (
	ingestionController: IngestionController,
	authService: AuthService
): Router => {
	const router = Router();

	// Secure all routes in this module
	router.use(requireAuth(authService));

	router.post('/', ingestionController.create);

	router.get('/', ingestionController.findAll);

	router.get('/:id', ingestionController.findById);

	router.put('/:id', ingestionController.update);

	router.delete('/:id', ingestionController.delete);

	router.post('/:id/import', ingestionController.triggerInitialImport);

	router.post('/:id/pause', ingestionController.pause);

	router.post('/:id/sync', ingestionController.triggerForceSync);

	return router;
};
