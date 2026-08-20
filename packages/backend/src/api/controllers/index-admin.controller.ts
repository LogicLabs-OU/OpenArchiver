import { Request, Response } from 'express';
import { SearchService } from '../../services/SearchService';
import { IndexMaintenanceService } from '../../services/IndexMaintenanceService';
import { AuditService } from '../../services/AuditService';
import { logger } from '../../config/logger';
import type { SearchTaskStatus, SearchTaskType } from '@open-archiver/types';

/**
 * Admin observability and maintenance for the search engine (Meilisearch): instance
 * overview, the task list, and orphan cleanup. All routes are Super-Admin gated at the router.
 */
export class IndexAdminController {
	private searchService = new SearchService();
	private auditService = new AuditService();

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

			const fromRaw =
				req.query.from !== undefined ? parseInt(String(req.query.from), 10) : NaN;
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

	/**
	 * Queues removal of index documents whose email is no longer in the database.
	 *
	 * 202 rather than 200: the sweep reads every document id in the index, which belongs in a job
	 * and not in a request. The body carries what the dispatch could establish cheaply, so the UI
	 * can say something true instead of only "accepted".
	 */
	public cleanupOrphans = async (req: Request, res: Response): Promise<Response> => {
		try {
			const userId = req.user?.sub;
			if (!userId) {
				return res.status(401).json({ message: req.t('errors.unauthorized') });
			}

			const dispatch = await IndexMaintenanceService.triggerCleanupOrphans();

			await this.auditService.createAuditLog({
				actorIdentifier: userId,
				actionType: 'REINDEX',
				targetType: 'SystemEvent',
				targetId: null,
				actorIp: req.ip || 'unknown',
				details: { scope: 'index-orphan-cleanup', ...dispatch },
			});

			return res.status(202).json({
				message: req.t('index.cleanupTriggered'),
				...dispatch,
			});
		} catch (error) {
			logger.error({ err: error }, 'Trigger index orphan cleanup error');
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};
}
