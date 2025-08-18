import { Router } from 'express';
import { SearchController } from '../controllers/search.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createSearchRouter = (
	searchController: SearchController,
	authService: AuthService
): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	router.get('/', requirePermission('archive:search', 'archive/all'), searchController.search);

	return router;
};
