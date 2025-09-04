import type { Request, Response } from 'express';
import { SettingsService } from '../../services/SettingsService';
import { config } from '../../config';

const settingsService = new SettingsService();

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
		// Basic validation can be performed here if necessary
		if (config.app.isDemo) {
			return res.status(403).json({ message: req.t('errors.demoMode') });
		}
		const updatedSettings = await settingsService.updateSystemSettings(req.body);
		res.status(200).json(updatedSettings);
	} catch (error) {
		// A more specific error could be logged here
		res.status(500).json({ message: req.t('settings.failedToUpdate') });
	}
};
