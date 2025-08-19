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

	router.post('/', requirePermission('create', 'users'), userController.createUser);

	router.put('/:id', requirePermission('update', 'users'), userController.updateUser);

	router.delete('/:id', requirePermission('delete', 'users'), userController.deleteUser);

	return router;
};
