import 'dotenv/config';

/**
 * @see https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/connections.md
 */
const connectionOptions: any = {
	host: process.env.REDIS_HOST || 'localhost',
	port: (process.env.REDIS_PORT && parseInt(process.env.REDIS_PORT, 10)) || 6379,
	password: process.env.REDIS_PASSWORD,
	enableReadyCheck: true,
};

if (process.env.REDIS_USER !== undefined || process.env.REDIS_USER === '') {
	connectionOptions.username = process.env.REDIS_USER;
}

if (process.env.REDIS_TLS_ENABLED === 'true') {
	connectionOptions.tls = {
		rejectUnauthorized: false,
	};
}

export const connection = connectionOptions;
