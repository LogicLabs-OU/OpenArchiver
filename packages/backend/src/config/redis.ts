import 'dotenv/config';
import { type ConnectionOptions } from 'bullmq';
import { intFromEnv } from '../helpers/intFromEnv';

/**
 * @see https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/connections.md
 */
const connectionOptions: ConnectionOptions = {
	host: process.env.REDIS_HOST || 'localhost',
	port: intFromEnv('REDIS_PORT', 6379, 1, 65535),
	password: process.env.REDIS_PASSWORD,
	enableReadyCheck: true,
};

// Trimmed, and applied only when something is left. Setting a username is not free: ioredis picks
// the two-argument ACL form of AUTH whenever one is present, and that form fails on a server
// configured with `requirepass` alone, where the only user that exists is `default`. A REDIS_USER of
// " " is truthy, so untrimmed it broke every connection exactly as an invented username does.
const redisUser = process.env.REDIS_USER?.trim();
if (redisUser) {
	connectionOptions.username = redisUser;
}

if (process.env.REDIS_TLS_ENABLED === 'true') {
	connectionOptions.tls = {
		rejectUnauthorized: false,
	};
}

export const connection = connectionOptions;
