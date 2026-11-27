import * as path from 'path';
import { Worker } from 'worker_threads';
import { config } from '../config';
import { logger } from '../config/logger';
import type {
	EmailParseRequest,
	EmailParseResponse,
	ParsedEmailForIndexing,
} from './emailParse.thread';

export type { ParsedEmailAttachment, ParsedEmailForIndexing } from './emailParse.thread';

/**
 * Parses a stored .eml for the indexer in a worker thread, with a hard timeout.
 *
 * mailparser is synchronous for long stretches. A message that sends it into a near-endless loop
 * used to hold the indexing worker's only thread: lock renewal, the heartbeat and every timeout
 * stopped with it, the email never failed so its index_attempts stayed at 0, and reconcile handed
 * it back after every restart (#526). In a thread, the main loop keeps running and a parse that
 * overruns is terminated, so the email fails like any other unparseable one and is counted.
 *
 * One thread, one parse at a time, the rest queued. Parsing was already serial on the main thread,
 * so this costs no throughput, and with one parse in flight a timeout always names the right email.
 */

const THREAD_FILE = path.join(__dirname, `emailParse.thread${path.extname(__filename)}`);

/** Extra time per MB of .eml, so a large but healthy message is not cut off by the base timeout. */
const TIMEOUT_MS_PER_MB = 2_000;

interface QueuedParse {
	eml: Buffer;
	withAttachments: boolean;
	resolve: (result: ParsedEmailForIndexing) => void;
	reject: (error: Error) => void;
}

let thread: Worker | null = null;
let inFlight: { id: number; job: QueuedParse; timer: NodeJS.Timeout } | null = null;
let nextId = 0;
const queue: QueuedParse[] = [];

const startThread = (): Worker => {
	const options: ConstructorParameters<typeof Worker>[1] = {};
	// Under ts-node-dev the thread file is TypeScript and needs the same loader. ts-node is only
	// resolvable through ts-node-dev in this workspace. The built .js never reaches this branch.
	if (path.extname(THREAD_FILE) === '.ts') {
		options.execArgv = [
			'-r',
			require.resolve('ts-node/register/transpile-only', {
				paths: [require.resolve('ts-node-dev/package.json')],
			}),
		];
	}

	const worker = new Worker(THREAD_FILE, options);

	// Every listener checks it still belongs to the current thread: a terminated thread reports its
	// exit after the next one may already be running another parse.
	worker.on('message', (message: EmailParseResponse) => {
		if (thread !== worker || !inFlight || message.id !== inFlight.id) {
			return;
		}
		const { job, timer } = inFlight;
		inFlight = null;
		clearTimeout(timer);
		if ('error' in message) {
			job.reject(new Error(message.error));
		} else {
			job.resolve(message.result);
		}
		next();
	});
	worker.on('error', (err) => {
		if (thread === worker) {
			threadLost(err);
		}
	});
	worker.on('exit', (code) => {
		if (thread === worker) {
			threadLost(new Error(`Email parse thread exited with code ${code}`));
		}
	});

	return worker;
};

/** The thread died on its own (out of heap, a crash): fail the parse it held and carry on. */
const threadLost = (err: Error): void => {
	logger.warn({ err }, 'Email parse thread stopped; starting a new one for the next email');
	thread = null;
	const current = inFlight;
	inFlight = null;
	if (current) {
		clearTimeout(current.timer);
		current.job.reject(err);
	}
	next();
};

const next = (): void => {
	if (inFlight) {
		return;
	}
	const job = queue.shift();
	if (!job) {
		// Idle: do not hold the process open on the thread's account.
		thread?.unref();
		return;
	}

	try {
		thread ??= startThread();
	} catch (err) {
		job.reject(err as Error);
		next();
		return;
	}
	thread.ref();

	const id = ++nextId;
	const timeoutMs =
		config.indexing.parseTimeoutMs +
		Math.ceil(job.eml.byteLength / (1024 * 1024)) * TIMEOUT_MS_PER_MB;
	// Started on hand-off, not on enqueue, so time spent waiting behind other emails does not count.
	const timer = setTimeout(() => {
		if (!inFlight || inFlight.id !== id) {
			return;
		}
		inFlight = null;
		// Detached first, so this thread's exit event is ignored rather than read as a crash.
		const stuck = thread;
		thread = null;
		void stuck?.terminate().catch(() => undefined);
		job.reject(new Error(`Email parse aborted after ${timeoutMs} ms`));
		next();
	}, timeoutMs);

	inFlight = { id, job, timer };
	const request: EmailParseRequest = {
		id,
		eml: job.eml,
		withAttachments: job.withAttachments,
	};
	thread.postMessage(request);
};

/**
 * @param eml The stored .eml.
 * @param withAttachments Return attachment bytes as well. Only needed when the email has no
 *   attachment records and its attachments are read out of the .eml (preserve-original mode).
 */
export const parseEmailForIndexing = (
	eml: Buffer,
	withAttachments: boolean
): Promise<ParsedEmailForIndexing> =>
	new Promise((resolve, reject) => {
		queue.push({ eml, withAttachments, resolve, reject });
		next();
	});
