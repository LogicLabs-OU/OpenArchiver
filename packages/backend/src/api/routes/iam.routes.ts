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
	router.get(
		'/roles',
		requirePermission('system:readUsers', 'system/users'),
		iamController.getRoles
	);


	router.get(
		'/roles/:id',
		requirePermission('system:readUsers', 'system/users'),
		iamController.getRoleById
	);


	router.post(
		'/roles',
		requirePermission('system:assignRole', 'system/users'),
		iamController.createRole
	);


	router.delete(
		'/roles/:id',
		requirePermission('system:deleteRole', 'system/users'),
		iamController.deleteRole
	);

	router.put(
		'/roles/:id',
		requirePermission('system:updateUser', 'system/users'),
		iamController.updateRole
	);
	return router;
};
