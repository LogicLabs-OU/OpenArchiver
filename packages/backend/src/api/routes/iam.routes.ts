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

	/**
	 * @route GET /api/v1/iam/roles/:id
	 * @description Gets a role by ID.
	 * @access Private
	 */
	router.get(
		'/roles/:id',
		requirePermission('system:readUsers', 'system/users'),
		iamController.getRoleById
	);

	/**
	 * @route POST /api/v1/iam/roles
	 * @description Creates a new role.
	 * @access Private
	 */
	router.post(
		'/roles',
		requirePermission('system:assignRole', 'system/users'),
		iamController.createRole
	);

	/**
	 * @route DELETE /api/v1/iam/roles/:id
	 * @description Deletes a role.
	 * @access Private
	 */
	router.delete(
		'/roles/:id',
		requirePermission('system:deleteRole', 'system/users'),
		iamController.deleteRole
	);
	return router;
};
