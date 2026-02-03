import { Router } from 'express';
import { JobsController } from '../controllers/jobs.controller';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { AuthService } from '../../services/AuthService';

export const createJobsRouter = (authService: AuthService): Router => {
	const router = Router();
	const jobsController = new JobsController();

	router.use(requireAuth(authService));

	router.get(
		'/queues',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		jobsController.getQueues
	);
	router.get(
		'/queues/:queueName',
		requirePermission('manage', 'all', 'user.requiresSuperAdminRole'),
		jobsController.getQueueJobs
	);

	return router;
};
