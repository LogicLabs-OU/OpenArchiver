import { logger } from './logger';

let explained = false;

/** Recognises a refusal to authenticate, as opposed to any other connection trouble. */
const AUTH_REFUSAL = /WRONGPASS|NOAUTH|invalid username-password|no password is set/i;

/**
 * Turns a Redis authentication refusal into a line that says what to change.
 *
 * Reported twice as an unexplained crash on a first install (#347, #448). What the user sees is an
 * ioredis stack trace naming the AUTH command, while the cause is almost always a REDIS_USER holding
 * a name the server has no user for: a server started with `requirepass` alone has exactly one user,
 * `default`, and asking for any other one fails every connection the process makes.
 *
 * Said once per process. ioredis retries a refused connection indefinitely, so an unguarded version
 * would bury its own advice under thousands of repetitions of it.
 *
 * Never throws, whatever it is handed. It runs inside the error handlers that keep the workers
 * alive, and an exception raised there would kill the process this exists to explain.
 */
export const explainRedisAuthError = (err: unknown): void => {
	try {
		if (explained) {
			return;
		}

		const message = err instanceof Error ? err.message : String(err ?? '');
		if (!AUTH_REFUSAL.test(message)) {
			return;
		}

		explained = true;
		const configuredUser = process.env.REDIS_USER?.trim();
		logger.error(
			{
				redisUser: configuredUser || '(not set)',
				redisHost: process.env.REDIS_HOST || 'localhost',
				error: message,
			},
			configuredUser
				? `Redis rejected the credentials. REDIS_USER is set to "${configuredUser}" — remove it unless your Redis/Valkey has an ACL user of that name, because a server running with requirepass only accepts the user "default".`
				: 'Redis rejected the credentials. Check that REDIS_PASSWORD matches the password the Redis/Valkey server was started with.'
		);
	} catch {
		// Explaining a failure must never become one.
	}
};
