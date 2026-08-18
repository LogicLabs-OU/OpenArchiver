import type { Worker } from 'bullmq';
import { logger } from '../config/logger';

/** How often the run loop is checked and the heartbeat refreshed. */
const CHECK_INTERVAL_MS = 30_000;

/**
 * Heartbeat TTL. Deliberately far wider than the write interval, and aligned with the indexing
 * worker's `lockDuration`: document building is largely synchronous (mailparser, pdf2json, xlsx) and
 * one large attachment can hold the event loop long enough to miss several ticks. A tighter TTL would
 * report a working worker as dead, which is a worse lie than reporting a just-stopped one as alive —
 * the key is deleted on a clean exit anyway.
 */
const HEARTBEAT_TTL_SECONDS = 10 * 60;

/** How long an exit path will wait on Redis before giving up and exiting regardless. */
const REDIS_EXIT_TIMEOUT_MS = 2_000;

/** Last-resort delay before a signalled process exits no matter what else is pending. */
const FORCED_EXIT_MS = 5_000;

/**
 * Runs a promise with a deadline, and **always resolves** — never rejects, never hangs.
 *
 * Exit paths cannot use a bare `await` on anything that talks to Redis. BullMQ forces
 * `maxRetriesPerRequest: null` on its connections (redis-connection.js:36), and with that setting
 * ioredis queues a command issued while the server is unreachable and neither resolves nor rejects
 * it — measured still pending after 8 seconds against a dead port. A `.catch()` never fires on a
 * promise that simply never settles, so error handling is no protection; only a deadline is.
 */
const withTimeout = async (promise: Promise<unknown>, ms: number): Promise<void> => {
	let timer: NodeJS.Timeout | undefined;
	await Promise.race([
		promise.catch(() => undefined),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, ms);
			timer.unref();
		}),
	]);
	if (timer) {
		clearTimeout(timer);
	}
};

/**
 * Makes a process exit 0 when it is signalled, after a bounded attempt at cleanup.
 *
 * Every command under `start:workers` needs this, not just the workers. `concurrently` normalizes
 * only SIGINT to exit 0 (kill-on-signal.js) and restarts anything closing non-zero, so a child that
 * dies by SIGTERM is respawned five seconds into `docker stop` and the tree never exits — measured:
 * a handler-less child produced two starts and concurrently was still alive 15 seconds later.
 *
 * @param label Identifies the process in the shutdown log line.
 * @param cleanup Best-effort work to finish first. Failures and hangs are both tolerated.
 */
export const exitOnSignals = (label: string, cleanup?: () => Promise<unknown>): void => {
	let shuttingDown = false;

	const shutdown = (signal: string) => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		logger.info({ process: label, signal }, 'Shutting down');

		// Fires even if the cleanup below stalls somewhere no deadline covers.
		setTimeout(() => {
			logger.warn({ process: label }, 'Cleanup did not finish in time - exiting anyway');
			process.exit(0);
		}, FORCED_EXIT_MS).unref();

		void (async () => {
			if (cleanup) {
				await withTimeout(cleanup(), REDIS_EXIT_TIMEOUT_MS);
			}
			process.exit(0);
		})();
	};

	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
};

/**
 * Redis key holding the last heartbeat for a queue's worker, as epoch milliseconds.
 * Read by the API so it can tell a user whether anything is actually consuming the queue
 * before promising that queued work will happen.
 *
 * A self-written key rather than `Queue.getWorkersCount()`: that call reads `CLIENT LIST` and matches
 * names set with `CLIENT SETNAME`, both of which managed Redis providers commonly restrict. Against
 * Aiven it reported zero workers while 48 worker sockets were open, which would have turned a
 * diagnostic into a lie.
 */
export const workerHeartbeatKey = (queueName: string): string => `oa:worker:${queueName}:alive`;

/**
 * Keeps a worker honest about its own state.
 *
 * BullMQ starts the run loop in the constructor as `this.run().catch(err => this.emit('error', err))`,
 * and pipes every blocking-connection error into the same `'error'` event. An EventEmitter with no
 * `'error'` listener throws, so a single Redis blip became an uncaught exception, which the
 * process-level handler logged and swallowed — leaving a live process whose run loop had stopped for
 * good. That is how an indexing queue sat at 1,561 waiting jobs for four days with the worker
 * processes still running and their sockets still open.
 *
 * So: listen for `'error'` so it stops being fatal, and separately watch whether the loop is still
 * running. If it is not, exit. A broken worker has to become a dead process for a supervisor to have
 * anything to restart.
 *
 * Known limitation: `isRunning()` only reports that the loop has not stopped. A blocking connection
 * that is permanently broken while ioredis keeps retrying leaves the loop "running" and consuming
 * nothing, and the heartbeat — written over a different, healthy client — would keep saying so.
 * Detecting that needs a consumed-jobs counter, which is not worth its complexity until the case is
 * actually seen; the `'error'` listener plus ioredis reconnection covers the common form.
 */
export const superviseWorker = (worker: Worker): void => {
	const queueName = worker.name;
	const heartbeatKey = workerHeartbeatKey(queueName);
	let stopping = false;

	// Without this listener the emit itself throws. With it, a connection error is what it should
	// be: noise to log while ioredis reconnects.
	worker.on('error', (err) => {
		logger.error({ err, queue: queueName }, 'Worker error');
	});

	const writeHeartbeat = async () => {
		const client = await worker.client;
		await client.set(heartbeatKey, Date.now(), 'EX', HEARTBEAT_TTL_SECONDS);
	};

	const clearHeartbeat = async () => {
		const client = await worker.client;
		await client.del(heartbeatKey);
	};

	// Written before the interval, not on its first tick: otherwise every start and every restart
	// opened a 30-second window in which the API told users no worker was running.
	void writeHeartbeat().catch((err) => {
		logger.warn({ err, queue: queueName }, 'Failed to write worker heartbeat');
	});

	const timer = setInterval(() => {
		if (stopping) {
			return;
		}

		if (!worker.isRunning()) {
			stopping = true;
			logger.fatal(
				{ queue: queueName },
				'Worker run loop is no longer running - exiting so the process supervisor restarts it'
			);
			// Bounded, and the exit does not depend on the outcome. The run loop usually dies
			// because Redis is in trouble, which is exactly when clearing the key can hang forever —
			// waiting on it would leave the wedged process this check exists to kill. The key's TTL
			// removes it regardless.
			void withTimeout(clearHeartbeat(), REDIS_EXIT_TIMEOUT_MS).then(() => process.exit(1));
			return;
		}

		void writeHeartbeat().catch((err) => {
			logger.warn({ err, queue: queueName }, 'Failed to write worker heartbeat');
		});
	}, CHECK_INTERVAL_MS);

	// Never hold the process open on our own account.
	timer.unref();

	exitOnSignals(queueName, async () => {
		stopping = true;
		clearInterval(timer);
		await withTimeout(clearHeartbeat(), REDIS_EXIT_TIMEOUT_MS);
		// close() talks to Redis too, so it gets the same deadline.
		await withTimeout(worker.close(), REDIS_EXIT_TIMEOUT_MS);
	});
};
