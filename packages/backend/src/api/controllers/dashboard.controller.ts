import { Request, Response } from 'express';
import { dashboardService } from '../../services/DashboardService';

class DashboardController {
	public async getStats(req: Request, res: Response) {
		const stats = await dashboardService.getStats();
		res.json(stats);
	}

	public async getIngestionHistory(req: Request, res: Response) {
		const history = await dashboardService.getIngestionHistory();
		res.json(history);
	}

	public async getIngestionSources(req: Request, res: Response) {
		const sources = await dashboardService.getIngestionSources();
		res.json(sources);
	}

	public async getRecentSyncs(req: Request, res: Response) {
		const syncs = await dashboardService.getRecentSyncs();
		res.json(syncs);
	}

	public async getIndexedInsights(req: Request, res: Response) {
		const insights = await dashboardService.getIndexedInsights();
		res.json(insights);
	}

	public async getIndexHealth(req: Request, res: Response) {
		const health = await dashboardService.getIndexHealth();
		res.json(health);
	}
}

export const dashboardController = new DashboardController();
