import { AuthorizationService } from '../../services/AuthorizationService';
import type { Request, Response, NextFunction } from 'express';

export const requirePermission = (action: string, resource: string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const userId = req.user?.sub;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        resource = resource.replace('{sourceId}', req.params.id)

        const hasPermission = await AuthorizationService.can(userId, action, resource);

        if (!hasPermission) {
            return res.status(403).json({ message: 'You are not allowed to perform this operation with your current role.' });
        }

        next();
    };
};
