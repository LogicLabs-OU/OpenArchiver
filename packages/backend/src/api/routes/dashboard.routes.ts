import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createDashboardRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	router.get('/stats', requirePermission('dashboard:read', 'dashboard/*'), dashboardController.getStats);
	router.get(
		'/ingestion-history',
		requirePermission('dashboard:read', 'dashboard/*'),
		dashboardController.getIngestionHistory
	);
	router.get(
		'/ingestion-sources',
		requirePermission('dashboard:read', 'dashboard/*'),
		dashboardController.getIngestionSources
	);
	router.get(
		'/recent-syncs',
		requirePermission('dashboard:read', 'dashboard/*'),
		dashboardController.getRecentSyncs
	);
	router.get(
		'/indexed-insights',
		requirePermission('dashboard:read', 'dashboard/*'),
		dashboardController.getIndexedInsights
	);

	return router;
};
