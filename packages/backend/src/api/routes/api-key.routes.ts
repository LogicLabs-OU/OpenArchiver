import { Router } from 'express';
import { ApiKeyController } from '../controllers/api-key.controller';
import { requireAuth } from '../middleware/requireAuth';
import { AuthService } from '../../services/AuthService';

export const apiKeyRoutes = (authService: AuthService): Router => {
	const router = Router();
	const controller = new ApiKeyController();

	router.post('/', requireAuth(authService), controller.generateApiKey);
	router.get('/', requireAuth(authService), controller.getApiKeys);
	router.delete('/:id', requireAuth(authService), controller.deleteApiKey);

	return router;
};
