import type { Request, Response } from 'express';
import { z } from 'zod';
import { DateBackfillService } from '../../services/DateBackfillService';

const startBodySchema = z.object({
	ingestionSourceId: z.string().uuid().optional(),
	batchSize: z.number().int().min(1).max(5000).optional(),
});

export class DateBackfillController {
	public start = async (req: Request, res: Response): Promise<Response | void> => {
		const parsed = startBodySchema.safeParse(req.body ?? {});
		if (!parsed.success) {
			return res.status(400).json({
				message: 'Invalid request body',
				errors: parsed.error.message,
			});
		}
		try {
			const { jobId } = await DateBackfillService.start(parsed.data);
			return res.status(202).json({ jobId });
		} catch (error) {
			return res.status(500).json({
				message: 'Error starting date-backfill job',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	public pause = async (_req: Request, res: Response): Promise<Response | void> => {
		try {
			await DateBackfillService.pause();
			return res.status(204).send();
		} catch (error) {
			return res.status(500).json({
				message: 'Error pausing date-backfill queue',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	public resume = async (_req: Request, res: Response): Promise<Response | void> => {
		try {
			await DateBackfillService.resume();
			return res.status(204).send();
		} catch (error) {
			return res.status(500).json({
				message: 'Error resuming date-backfill queue',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	public status = async (req: Request, res: Response): Promise<Response | void> => {
		try {
			const { jobId } = req.params;
			const status = await DateBackfillService.status(jobId);
			return res.status(200).json(status);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (msg.includes('not found')) {
				return res.status(404).json({ message: msg });
			}
			return res.status(500).json({
				message: 'Error fetching date-backfill status',
				error: msg,
			});
		}
	};
}
