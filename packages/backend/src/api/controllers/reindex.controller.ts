import type { Request, Response } from 'express';
import { ReindexService } from '../../services/ReindexService';
import type { ReindexScope } from '../../services/ReindexService';

const VALID_SCOPES: ReindexScope[] = ['full', 'date', 'new-fields-only'];

export class ReindexController {
	public start = async (req: Request, res: Response): Promise<Response | void> => {
		try {
			const body = (req.body ?? {}) as {
				scope?: string;
				ingestionSourceId?: string;
				dateFrom?: string;
				dateTo?: string;
				batchSize?: number;
			};

			if (!body.scope || !VALID_SCOPES.includes(body.scope as ReindexScope)) {
				return res.status(400).json({
					message: `Invalid scope. Must be one of: ${VALID_SCOPES.join(', ')}`,
				});
			}

			if (
				typeof body.batchSize !== 'undefined' &&
				(typeof body.batchSize !== 'number' ||
					!Number.isInteger(body.batchSize) ||
					body.batchSize < 1 ||
					body.batchSize > 5000)
			) {
				return res
					.status(400)
					.json({ message: 'batchSize must be an integer between 1 and 5000' });
			}

			const { jobId } = await ReindexService.start({
				scope: body.scope as ReindexScope,
				ingestionSourceId: body.ingestionSourceId,
				dateFrom: body.dateFrom,
				dateTo: body.dateTo,
				batchSize: body.batchSize,
			});
			return res.status(202).json({ jobId });
		} catch (error) {
			return res.status(500).json({
				message: 'Error starting reindex job',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	public status = async (req: Request, res: Response): Promise<Response | void> => {
		try {
			const { jobId } = req.params;
			const status = await ReindexService.status(jobId);
			return res.status(200).json(status);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (msg.includes('not found')) {
				return res.status(404).json({ message: msg });
			}
			return res.status(500).json({ message: 'Error fetching reindex status', error: msg });
		}
	};

	public cancel = async (req: Request, res: Response): Promise<Response | void> => {
		try {
			const { jobId } = req.params;
			await ReindexService.cancel(jobId);
			return res.status(204).send();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (msg.includes('not found')) {
				return res.status(404).json({ message: msg });
			}
			return res.status(500).json({ message: 'Error cancelling reindex job', error: msg });
		}
	};
}
