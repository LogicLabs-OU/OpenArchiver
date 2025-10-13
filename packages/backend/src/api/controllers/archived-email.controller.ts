import { Request, Response } from 'express';
import { ArchivedEmailService } from '../../services/ArchivedEmailService';
import { config } from '../../config';

export class ArchivedEmailController {
	public getArchivedEmails = async (req: Request, res: Response): Promise<Response> => {
		try {
			const { ingestionSourceId } = req.params;
			const page = parseInt(req.query.page as string, 10) || 1;
			const limit = parseInt(req.query.limit as string, 10) || 10;
			const path =
				req.query.path === undefined
					? undefined
					: req.query.path === 'null'
						? null
						: (req.query.path as string);
			const sortBy = (req.query.sortBy as 'sentAt' | 'senderEmail' | 'subject') || 'sentAt';
			const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc';
			const userId = req.user?.sub;

			if (!userId) {
				return res.status(401).json({ message: req.t('errors.unauthorized') });
			}

			const query = {
				ingestionSourceId,
				page,
				limit,
				path,
				sortBy,
				sortOrder,
			};

			const result = await ArchivedEmailService.getArchivedEmails(query, userId);
			return res.status(200).json(result);
		} catch (error) {
			console.error('Get archived emails error:', error);
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};

	public getArchivedEmailById = async (req: Request, res: Response): Promise<Response> => {
		try {
			const { id } = req.params;
			const userId = req.user?.sub;

			if (!userId) {
				return res.status(401).json({ message: req.t('errors.unauthorized') });
			}

			const email = await ArchivedEmailService.getArchivedEmailById(id, userId);
			if (!email) {
				return res.status(404).json({ message: req.t('archivedEmail.notFound') });
			}
			return res.status(200).json(email);
		} catch (error) {
			console.error(`Get archived email by id ${req.params.id} error:`, error);
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};

	public deleteArchivedEmail = async (req: Request, res: Response): Promise<Response> => {
		if (config.app.isDemo) {
			return res.status(403).json({ message: req.t('errors.demoMode') });
		}
		try {
			const { id } = req.params;
			await ArchivedEmailService.deleteArchivedEmail(id);
			return res.status(204).send();
		} catch (error) {
			console.error(`Delete archived email ${req.params.id} error:`, error);
			if (error instanceof Error) {
				if (error.message === 'Archived email not found') {
					return res.status(404).json({ message: req.t('archivedEmail.notFound') });
				}
				return res.status(500).json({ message: error.message });
			}
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};

	public getFolders = async (req: Request, res: Response): Promise<Response> => {
		try {
			const { ingestionSourceId } = req.params;
			const userId = req.user?.sub;

			if (!userId) {
				return res.status(401).json({ message: req.t('errors.unauthorized') });
			}

			const folders = await ArchivedEmailService.getFolderStructure(
				ingestionSourceId,
				userId
			);
			return res.status(200).json(folders);
		} catch (error) {
			console.error('Get folders error:', error);
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}
	};
}
