import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createUserRouter = (authService: AuthService): Router => {
    const router = Router();

    router.use(requireAuth(authService));

    router.get(
        '/',
        requirePermission('system:readUsers', 'system/users'),
        userController.getUsers
    );

    router.get(
        '/:id',
        requirePermission('system:readUsers', 'system/user/{userId}'),
        userController.getUser
    );

    router.post(
        '/',
        requirePermission('system:createUser', 'system/users'),
        userController.createUser
    );

    router.put(
        '/:id',
        requirePermission('system:updateUser', 'system/user/{userId}'),
        userController.updateUser
    );

    router.delete(
        '/:id',
        requirePermission('system:deleteUser', 'system/user/{userId}'),
        userController.deleteUser
    );

    return router;
};
