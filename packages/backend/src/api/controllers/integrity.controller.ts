import { Request, Response } from 'express';
import { IntegrityService } from '../../services/IntegrityService';
import { z } from 'zod';

const checkIntegritySchema = z.object({
	id: z.string().uuid(),
});

export class IntegrityController {
	private integrityService = new IntegrityService();

	public checkIntegrity = async (req: Request, res: Response) => {
		try {
			const { id } = checkIntegritySchema.parse(req.params);
			const results = await this.integrityService.checkEmailIntegrity(id);
			res.status(200).json(results);
		} catch (error) {
			if (error instanceof z.ZodError) {
				return res
					.status(400)
					.json({ message: req.t('api.requestBodyInvalid'), errors: error.message });
			}
			if (error instanceof Error && error.message === 'Archived email not found') {
				return res.status(404).json({ message: req.t('errors.notFound') });
			}
			res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};
}
