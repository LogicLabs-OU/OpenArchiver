import type { Queue } from 'bullmq';
import { indexingQueue } from '../queues';
import { workerHeartbeatKey } from '../../workers/supervision';
import { logger } from '../../config/logger';

/**
 * Whether a worker is currently consuming the given queue.
 *
 * Reads the heartbeat the worker refreshes on a timer, over the queue's existing Redis connection.
 * If the key is gone, either no worker process is running or its run loop has stopped — both mean
 * queued work will sit untouched, and both should be said out loud rather than answered with a
 * cheerful 202.
 *
 * Deliberately not `Queue.getWorkersCount()`: that reads `CLIENT LIST` and matches names set with
 * `CLIENT SETNAME`, which managed Redis providers commonly restrict. Tested against Aiven it
 * reported zero workers while 48 worker sockets were open.
 *
 * Errs on the side of "alive" when Redis itself cannot be reached, so an infrastructure blip does
 * not produce a confidently wrong warning about workers.
 */
export const isWorkerAlive = async (queue: Queue): Promise<boolean> => {
	try {
		const client = await queue.client;
		return (await client.exists(workerHeartbeatKey(queue.name))) === 1;
	} catch (error) {
		logger.warn({ error, queue: queue.name }, 'Could not read the worker heartbeat');
		return true;
	}
};

/** Convenience for the reindex endpoints, which only ever ask about the indexing queue. */
export const isIndexingWorkerAlive = (): Promise<boolean> => isWorkerAlive(indexingQueue);
