import { Request, Response } from 'express';
import { ApiKeyService } from '../../services/ApiKeyService';
import { z } from 'zod';
import { config } from '../../config';

const generateApiKeySchema = z.object({
	name: z
		.string()
		.min(1, 'API kay name must be more than 1 characters')
		.max(255, 'API kay name must not be more than 255 characters'),
	expiresInDays: z
		.number()
		.int()
		.positive('Only positive number is allowed')
		.max(730, 'The API key must expire within 2 years / 730 days.'),
});

export class ApiKeyController {
	public async generateApiKey(req: Request, res: Response) {
		if (config.app.isDemo) {
			return res.status(403).json({ message: req.t('errors.demoMode') });
		}
		try {
			const { name, expiresInDays } = generateApiKeySchema.parse(req.body);
			if (!req.user || !req.user.sub) {
				return res.status(401).json({ message: 'Unauthorized' });
			}
			const userId = req.user.sub;

			const key = await ApiKeyService.generate(userId, name, expiresInDays);

			res.status(201).json({ key });
		} catch (error) {
			if (error instanceof z.ZodError) {
				return res
					.status(400)
					.json({ message: req.t('api.requestBodyInvalid'), errors: error.message });
			}
			res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	}

	public async getApiKeys(req: Request, res: Response) {
		if (!req.user || !req.user.sub) {
			return res.status(401).json({ message: 'Unauthorized' });
		}
		const userId = req.user.sub;
		const keys = await ApiKeyService.getKeys(userId);

		res.status(200).json(keys);
	}

	public async deleteApiKey(req: Request, res: Response) {
		if (config.app.isDemo) {
			return res.status(403).json({ message: req.t('errors.demoMode') });
		}
		const { id } = req.params;
		if (!req.user || !req.user.sub) {
			return res.status(401).json({ message: 'Unauthorized' });
		}
		const userId = req.user.sub;
		await ApiKeyService.deleteKey(id, userId);

		res.status(204).send({ message: req.t('apiKeys.deleteSuccess') });
	}
}
