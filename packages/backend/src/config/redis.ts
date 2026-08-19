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

if (process.env.REDIS_USER) {
	connectionOptions.username = process.env.REDIS_USER;
}

if (process.env.REDIS_TLS_ENABLED === 'true') {
	connectionOptions.tls = {
		rejectUnauthorized: false,
	};
}

export const connection = connectionOptions;
