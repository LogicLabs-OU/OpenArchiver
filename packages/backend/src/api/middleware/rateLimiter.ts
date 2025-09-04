import rateLimit from 'express-rate-limit';
import { config } from '../../config';

const windowInMinutes = Math.ceil(config.api.rateLimit.windowMs / 60000);

export const rateLimiter = rateLimit({
	windowMs: config.api.rateLimit.windowMs,
	max: config.api.rateLimit.max,
	message: `Too many requests from this IP, please try again after ${windowInMinutes} minutes`,
	standardHeaders: true,
	legacyHeaders: false,
});
