import { Request, Response } from 'express';
import { SearchService } from '../../services/SearchService';
import { logger } from '../../config/logger';
import type { SearchTaskStatus, SearchTaskType } from '@open-archiver/types';

/**
 * Read-only admin observability for the search engine (Meilisearch): instance
 * overview and the task list. All routes are Super-Admin gated at the router.
 */
export class IndexAdminController {
	private searchService = new SearchService();

	public getOverview = async (req: Request, res: Response): Promise<Response> => {
		try {
			const overview = await this.searchService.getInstanceOverview();
			return res.status(200).json(overview);
		} catch (error) {
			logger.error({ err: error }, 'Get search index overview error');
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};

	public getTasks = async (req: Request, res: Response): Promise<Response> => {
		try {
			const limitRaw = parseInt(String(req.query.limit ?? '20'), 10);
			const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

			const fromRaw = req.query.from !== undefined ? parseInt(String(req.query.from), 10) : NaN;
			const from = Number.isFinite(fromRaw) ? fromRaw : undefined;

			const parseList = (v: unknown): string[] | undefined => {
				if (typeof v !== 'string' || v.trim() === '') return undefined;
				return v
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
			};

			const statuses = parseList(req.query.statuses) as SearchTaskStatus[] | undefined;
			const types = parseList(req.query.types) as SearchTaskType[] | undefined;

			const tasks = await this.searchService.getTasks({ limit, from, statuses, types });
			return res.status(200).json(tasks);
		} catch (error) {
			logger.error({ err: error }, 'Get search index tasks error');
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};
}
