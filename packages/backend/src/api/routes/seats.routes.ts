import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';
import * as controller from '../controllers/seats.controller';

/**
 * Seat accounting, mounted at /v1/seats.
 *
 * Part of the open-source edition on purpose. Seats decide what an Enterprise licence costs, so
 * the question "how many would we need?" has to be answerable before anyone buys one — and the
 * answer is computed entirely from data this edition already holds. Only the reporting and
 * enforcement built on top of it are enterprise concerns.
 *
 * Super Admin throughout: these endpoints list every mailbox in the archive.
 */
export const createSeatsRouter = (authService: AuthService): Router => {
	const router = Router();

	router.use(requireAuth(authService));

	const superAdmin = requirePermission('manage', 'all', 'user.requiresSuperAdminRole');

	router.get('/report', superAdmin, controller.getReport);
	router.post('/reconcile', superAdmin, controller.reconcile);
	router.get('/mailboxes', superAdmin, controller.listMailboxes);
	router.put('/mailboxes/:id/classification', superAdmin, controller.updateClassification);
	router.put('/mailboxes/:id/identity-link', superAdmin, controller.updateIdentityLink);
	router.get('/policy', superAdmin, controller.getPolicy);
	router.put('/policy', superAdmin, controller.updatePolicy);

	return router;
};
