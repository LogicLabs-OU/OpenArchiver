import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import type { IamController } from '../controllers/iam.controller';
import type { AuthService } from '../../services/AuthService';

export const createIamRouter = (iamController: IamController, authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	/**
	 * @route GET /api/v1/iam/roles
	 * @description Gets all roles.
	 * @access Private
	 */
	router.get('/roles', requirePermission('read', 'roles'), iamController.getRoles);

	router.get('/roles/:id', requirePermission('read', 'roles'), iamController.getRoleById);

	router.post('/roles', requirePermission('create', 'roles'), iamController.createRole);

	router.delete('/roles/:id', requirePermission('delete', 'roles'), iamController.deleteRole);

	router.put('/roles/:id', requirePermission('update', 'roles'), iamController.updateRole);
	return router;
};
