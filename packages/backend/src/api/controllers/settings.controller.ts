import type { Request, Response } from 'express';
import { SettingsService } from '../../services/SettingsService';

const settingsService = new SettingsService();

export const getSettings = async (req: Request, res: Response) => {
	try {
		const settings = await settingsService.getSettings();
		res.status(200).json(settings);
	} catch (error) {
		// A more specific error could be logged here
		res.status(500).json({ message: req.t('settings.failedToRetrieve') });
	}
};

export const updateSettings = async (req: Request, res: Response) => {
	try {
		// Basic validation can be performed here if necessary
		const updatedSettings = await settingsService.updateSettings(req.body);
		res.status(200).json(updatedSettings);
	} catch (error) {
		// A more specific error could be logged here
		res.status(500).json({ message: req.t('settings.failedToUpdate') });
	}
};
