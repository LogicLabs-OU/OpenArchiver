import { Router } from 'express';
import { uploadFile } from '../controllers/upload.controller';
import { requireAuth } from '../middleware/requireAuth';
import { AuthService } from '../../services/AuthService';
import { requirePermission } from '../middleware/requirePermission';

export const createUploadRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	router.post('/', requirePermission('create', 'ingestion'), uploadFile);

	return router;
};
