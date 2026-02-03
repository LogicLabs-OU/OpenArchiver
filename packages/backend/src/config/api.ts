import 'dotenv/config';

export const apiConfig = {
	rateLimit: {
		windowMs: process.env.RATE_LIMIT_WINDOW_MS
			? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
			: 1 * 60 * 1000, // 1 minutes
		max: process.env.RATE_LIMIT_MAX_REQUESTS
			? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10)
			: 100, // limit each IP to 100 requests per windowMs
	},
	version: 'v1',
};
