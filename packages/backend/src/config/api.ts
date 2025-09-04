import 'dotenv/config';

export const apiConfig = {
    rateLimit: {
        windowMs: process.env.RATE_LIMIT_WINDOW_MS ? parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) : 15 * 60 * 1000, // 15 minutes
        max: process.env.RATE_LIMIT_MAX_REQUESTS ? parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) : 100, // limit each IP to 100 requests per windowMs
    }
};
