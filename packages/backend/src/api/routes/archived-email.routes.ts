import { Router } from 'express';
import { ArchivedEmailController } from '../controllers/archived-email.controller';
import { requireAuth } from '../middleware/requireAuth';
import { AuthService } from '../../services/AuthService';

export const createArchivedEmailRouter = (
    archivedEmailController: ArchivedEmailController,
    authService: AuthService
): Router => {
    const router = Router();

    // Secure all routes in this module
    router.use(requireAuth(authService));

    router.get('/ingestion-source/:ingestionSourceId', archivedEmailController.getArchivedEmails);

    router.get('/:id', archivedEmailController.getArchivedEmailById);

    router.delete('/:id', archivedEmailController.deleteArchivedEmail);

    return router;
};
