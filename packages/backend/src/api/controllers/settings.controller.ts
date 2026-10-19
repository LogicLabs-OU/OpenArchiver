import type { Request, Response } from 'express';
import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '@open-archiver/types';
import { SettingsService } from '../../services/SettingsService';
import { UserService } from '../../services/UserService';

const settingsService = new SettingsService();
const userService = new UserService();

/**
 * What a settings update may carry. Unknown keys are stripped, so nothing from the request body
 * reaches the shared settings record except these four; the service allowlists them again.
 */
const UpdateSettingsSchema = z
	.object({
		language: z.enum(SUPPORTED_LANGUAGES),
		theme: z.enum(['light', 'dark', 'system']),
		supportEmail: z.string().trim().email().nullable(),
		dateFormat: z.enum(['language', 'iso', 'eu', 'us']),
	})
	.partial();

export const getSystemSettings = async (req: Request, res: Response) => {
	try {
		const settings = await settingsService.getSystemSettings();
		res.status(200).json(settings);
	} catch (error) {
		// A more specific error could be logged here
		res.status(500).json({ message: req.t('settings.failedToRetrieve') });
	}
};

export const updateSystemSettings = async (req: Request, res: Response) => {
	try {
		if (!req.user || !req.user.sub) {
			return res.status(401).json({ message: 'Unauthorized' });
		}
		const actor = await userService.findById(req.user.sub);
		if (!actor) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		const parsed = UpdateSettingsSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(422).json({
				message: req.t('settings.invalidSettings'),
				errors: parsed.error.flatten(),
			});
		}

		const updatedSettings = await settingsService.updateSystemSettings(
			parsed.data,
			actor,
			req.ip || 'unknown'
		);
		res.status(200).json(updatedSettings);
	} catch (error) {
		// A more specific error could be logged here
		res.status(500).json({ message: req.t('settings.failedToUpdate') });
	}
};
