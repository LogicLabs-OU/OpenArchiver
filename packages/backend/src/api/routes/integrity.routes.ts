import { Router } from 'express';
import { IntegrityController } from '../controllers/integrity.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const integrityRoutes = (authService: AuthService): Router => {
	const router = Router();
	const controller = new IntegrityController();

	router.use(requireAuth(authService));

	router.get('/:id', requirePermission('read', 'archive'), controller.checkIntegrity);

	return router;
};
