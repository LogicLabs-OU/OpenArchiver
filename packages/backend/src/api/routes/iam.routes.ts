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

	/**
	 * Only super admin has the ability to modify existing roles or create new roles.
	 */
	router.post(
		'/roles',
		requirePermission('manage', 'all', 'iam.requiresSuperAdminRole'),
		iamController.createRole
	);

	router.delete(
		'/roles/:id',
		requirePermission('manage', 'all', 'iam.requiresSuperAdminRole'),
		iamController.deleteRole
	);

	router.put(
		'/roles/:id',
		requirePermission('manage', 'all', 'iam.requiresSuperAdminRole'),
		iamController.updateRole
	);
	return router;
};
