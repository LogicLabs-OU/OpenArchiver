import 'dotenv/config';
import { intFromEnv } from '../helpers/intFromEnv';

export const apiConfig = {
	rateLimit: {
		windowMs: intFromEnv('RATE_LIMIT_WINDOW_MS', 1 * 60 * 1000, 1), // 1 minutes
		max: intFromEnv('RATE_LIMIT_MAX_REQUESTS', 100, 1), // limit each IP to 100 requests per windowMs
	},
	version: 'v1',
};
