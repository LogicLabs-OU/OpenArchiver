import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createUserRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	router.get('/', requirePermission('read', 'users'), userController.getUsers);

	router.get('/profile', userController.getProfile);
	router.patch('/profile', userController.updateProfile);
	router.post('/profile/password', userController.updatePassword);

	router.get('/:id', requirePermission('read', 'users'), userController.getUser);

	/**
	 * Only super admin has the ability to modify existing users or create new users.
	 */
	router.post(
		'/',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		userController.createUser
	);

	router.put(
		'/:id',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		userController.updateUser
	);

	router.delete(
		'/:id',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		userController.deleteUser
	);

	return router;
};
