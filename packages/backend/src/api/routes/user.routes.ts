import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createUserRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	router.get('/', requirePermission('read', 'users'), userController.getUsers);

	router.get('/:id', requirePermission('read', 'users'), userController.getUser);

	/**
	 * Only super admin has the ability to modify existing users or create new users.
	 */
	router.post(
		'/',
		requirePermission('manage', 'all', 'Super Admin role is required to manage users.'),
		userController.createUser
	);

	router.put(
		'/:id',
		requirePermission('manage', 'all', 'Super Admin role is required to manage users.'),
		userController.updateUser
	);

	router.delete(
		'/:id',
		requirePermission('manage', 'all', 'Super Admin role is required to manage users.'),
		userController.deleteUser
	);

	return router;
};
