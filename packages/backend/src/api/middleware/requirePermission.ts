import { AuthorizationService } from '../../services/AuthorizationService';
import type { Request, Response, NextFunction } from 'express';
import { AppActions, AppSubjects } from '@open-archiver/types';
import type { SubjectObject } from '../../iam-policy/ability';
import { IngestionService } from '../../services/IngestionService';
import { ArchivedEmailService } from '../../services/ArchivedEmailService';
import { logger } from '../../config/logger';

/**
 * Fetches the record a request targets, so policy conditions can be evaluated against it.
 *
 * Return `null`/`undefined` when the record does not exist; the request is then answered with 404
 * instead of being handed to the controller.
 */
export type ResourceLoader = (req: Request) => Promise<SubjectObject | null | undefined>;

export interface RequirePermissionOptions {
	/** Translation key for the 403 body. Defaults to `errors.noPermissionToAction`. */
	rejectMessage?: string;
	/**
	 * Required on any route that acts on a single record. Without it the check only asks whether
	 * the role may perform the action on the resource *type*, so a role scoped to one ingestion
	 * source or one mailbox would pass for every other one.
	 */
	loadResource?: ResourceLoader;
}

export const requirePermission = (
	action: AppActions,
	subjectName: AppSubjects,
	options?: string | RequirePermissionOptions
) => {
	// The third argument used to be the rejection message; both forms stay valid.
	const { rejectMessage, loadResource }: RequirePermissionOptions =
		typeof options === 'string' ? { rejectMessage: options } : (options ?? {});

	return async (req: Request, res: Response, next: NextFunction) => {
		const userId = req.user?.sub;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		let resourceObject: SubjectObject | undefined;
		if (loadResource) {
			try {
				resourceObject = (await loadResource(req)) ?? undefined;
			} catch (error) {
				// A record that cannot be loaded cannot be authorized, so treat it as absent
				// rather than letting the request through unchecked.
				logger.warn(
					{ error, path: req.path, method: req.method },
					'Permission check could not load the target record'
				);
			}

			if (!resourceObject) {
				return res.status(404).json({ message: req.t('errors.notFound') });
			}
		}

		const authorizationService = new AuthorizationService();
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

		next();
	};
};

/** Loads the ingestion source named by `:id`, for routes that act on one source. */
export const ingestionResource: ResourceLoader = (req) =>
	IngestionService.findRowById(req.params.id);

/** Loads the archived email named by `:id`, together with its source. */
export const archivedEmailResource: ResourceLoader = (req) =>
	ArchivedEmailService.findRowById(req.params.id);
