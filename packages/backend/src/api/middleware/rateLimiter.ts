import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from '../../config';

const windowInMinutes = Math.ceil(config.api.rateLimit.windowMs / 60000);

export const rateLimiter = rateLimit({
	windowMs: config.api.rateLimit.windowMs,
	max: config.api.rateLimit.max,
	keyGenerator: (req, res) => {
		// Use the real IP address of the client, even if it's behind a proxy.
		// `app.set('trust proxy', true)` in `server.ts`.
		return ipKeyGenerator(req.ip || 'unknown');
	},
	message: {
		status: 429,
		message: `Too many requests from this IP, please try again after ${windowInMinutes} minutes`,
	},
	statusCode: 429,
	standardHeaders: true,
	legacyHeaders: false,
});
