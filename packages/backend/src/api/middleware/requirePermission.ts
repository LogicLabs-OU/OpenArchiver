import { AuthorizationService } from '../../services/AuthorizationService';
import type { Request, Response, NextFunction } from 'express';
import { AppActions, AppSubjects } from '@open-archiver/types';

export const requirePermission = (
	action: AppActions,
	subjectName: AppSubjects,
	rejectMessage?: string
) => {
	return async (req: Request, res: Response, next: NextFunction) => {
		const userId = req.user?.sub;

		if (!userId) {
			return res.status(401).json({ message: req.t('errors.unauthorized') });
		}

		let resourceObject = undefined;
		// Logic to fetch resourceObject if needed for condition-based checks...
		const authorizationService = new AuthorizationService();
		try {
			const hasPermission = await authorizationService.can(
				userId,
				action,
				subjectName,
				resourceObject
			);

			if (!hasPermission) {
				const message = rejectMessage
					? req.t(rejectMessage)
					: req.t('errors.noPermissionToAction');
				return res.status(403).json({
					message,
				});
			}
		} catch (err) {
			if (err instanceof Error && err.message === 'User not found') {
				return res.status(401).json({ message: req.t('errors.unauthorized') });
			}
			return res.status(500).json({ message: req.t('errors.internalServerError') });
		}

		next();
	};
};
