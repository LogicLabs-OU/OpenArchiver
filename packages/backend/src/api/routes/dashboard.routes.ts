import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createDashboardRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	router.get(
		'/stats',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getStats
	);
	router.get(
		'/ingestion-history',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getIngestionHistory
	);
	router.get(
		'/ingestion-sources',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getIngestionSources
	);
	router.get(
		'/recent-syncs',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getRecentSyncs
	);
	router.get(
		'/indexed-insights',
		requirePermission('read', 'dashboard', 'dashboard.permissionRequired'),
		dashboardController.getIndexedInsights
	);

	return router;
};
