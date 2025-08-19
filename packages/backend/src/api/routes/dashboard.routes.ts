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
		requirePermission(
			'read',
			'dashboard',
			'You need the dashboard read permission to view dashboard stats.'
		),
		dashboardController.getStats
	);
	router.get(
		'/ingestion-history',
		requirePermission(
			'read',
			'dashboard',
			'You need the dashboard read permission to view dashboard data.'
		),
		dashboardController.getIngestionHistory
	);
	router.get(
		'/ingestion-sources',
		requirePermission(
			'read',
			'dashboard',
			'You need the dashboard read permission to view dashboard data.'
		),
		dashboardController.getIngestionSources
	);
	router.get(
		'/recent-syncs',
		requirePermission(
			'read',
			'dashboard',
			'You need the dashboard read permission to view dashboard data.'
		),
		dashboardController.getRecentSyncs
	);
	router.get(
		'/indexed-insights',
		requirePermission(
			'read',
			'dashboard',
			'You need the dashboard read permission to view dashboard data.'
		),
		dashboardController.getIndexedInsights
	);

	return router;
};
