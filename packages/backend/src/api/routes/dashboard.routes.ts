import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/requireAuth';
import { AuthService } from '../../services/AuthService';

export const createDashboardRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	router.get('/stats', dashboardController.getStats);
	router.get('/ingestion-history', dashboardController.getIngestionHistory);
	router.get('/ingestion-sources', dashboardController.getIngestionSources);
	router.get('/recent-syncs', dashboardController.getRecentSyncs);
	router.get('/indexed-insights', dashboardController.getIndexedInsights);

	return router;
};
