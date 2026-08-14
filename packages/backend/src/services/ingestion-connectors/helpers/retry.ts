import { logger } from '../../../config/logger';

/**
 * Shared failure handling for the API-based connectors (Google Workspace, Microsoft 365).
 *
 * Both providers answer a small share of requests with an error that means nothing more than "ask
 * again". Left unhandled, one of them ends the whole mailbox: the connector generator throws, the
 * process-mailbox job reports a failed mailbox, and everything after the bad message is abandoned
 * for that cycle (issue #441).
 */

/**
 * How long a single provider request may take before it is abandoned.
 *
 * Neither SDK sets one of its own — gaxios documents "No timeout by default" and the Graph client
 * passes no signal — so a socket that never answers leaves the mailbox job awaiting forever. BullMQ
 * renews the job's lock while its promise is pending and the session heartbeat keeps ticking, so
 * nothing upstream notices; the source sits in 'syncing' and the scheduler, which only admits
 * 'active' and 'error', never picks it up again.
 *
 * This bounds a hang rather than targeting performance. Three attempts plus backoff stays well
 * inside cleanStaleSessions()'s 30-minute threshold, with room for a large attachment on a slow
 * link.
 */
export const REQUEST_TIMEOUT_MS = 120_000;

/** Node error codes that mean the connection failed rather than the request being refused. */
const NETWORK_ERROR_CODES = new Set([
	'ECONNRESET',
	'ECONNREFUSED',
	'ETIMEDOUT',
	'EPIPE',
	'EAI_AGAIN',
	'ENOTFOUND',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'ERR_STREAM_PREMATURE_CLOSE',
	// Not errnos: what an AbortSignal produces once REQUEST_TIMEOUT_MS elapses. Gaxios reports the
	// DOMException's name here and leaves the status empty, so without these the request timeout
	// above would be given up on after a single attempt.
	'TimeoutError',
	'AbortError',
]);

export const isNetworkErrorCode = (code: unknown): boolean =>
	typeof code === 'string' && NETWORK_ERROR_CODES.has(code);

/**
 * Whether a raw transport error — one that never became a provider error object — means the
 * connection failed rather than the request being refused.
 *
 * Both fields are read because the two shapes disagree on where the name lives. A Node system error
 * puts its errno on `code`, while the `DOMException` an `AbortSignal.timeout` produces puts the
 * legacy numeric constant there (23 for `TimeoutError`) and the name on `name`. Reading only `code`
 * gives a body download that hit the deadline a single attempt instead of the three it is owed.
 */
export const isTransportError = (error: unknown): boolean =>
	isNetworkErrorCode((error as any)?.code) || isNetworkErrorCode((error as any)?.name);

/**
 * The statuses that are worth another attempt whichever provider returned them: a request timeout,
 * a throttle, or a server-side fault.
 */
export const isRetryableStatus = (status: number | undefined): boolean =>
	status === 408 || status === 429 || (status !== undefined && status >= 500 && status <= 599);

/**
 * Runs an action again while `isRetryable` says the failure was transient.
 *
 * Both SDKs already retry some of these internally — gaxios does 408/429/5xx because
 * `googleapis-common` turns retries on by default, and the Graph client ships a retry handler for
 * 429/503/504 — so three attempts here is deliberately modest. This layer exists for the cases
 * their defaults miss and for the ones that survive their attempts.
 */
export async function withRetry<T>(
	action: () => Promise<T>,
	isRetryable: (error: unknown) => boolean,
	context: Record<string, unknown>,
	attempts = 3
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await action();
		} catch (error) {
			if (attempt >= attempts || !isRetryable(error)) {
				throw error;
			}
			const delayMs = Math.round(2 ** attempt * 500 + Math.random() * 500);
			logger.warn(
				{ err: error, ...context, attempt, delayMs },
				'Transient provider error, retrying.'
			);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
}

/**
 * Counts the messages a connector gave up on so the mailbox could finish, and decides when the
 * failures stop looking isolated.
 *
 * One instance lives on one connector, and a connector is built per mailbox job, so the tally is
 * per mailbox. `process-mailbox.processor` folds the result into its own per-message accounting,
 * which marks the mailbox failed and discards this run's sync state — that is what makes the next
 * cycle re-attempt the skipped messages rather than advance past them.
 */
export class MessageFailureTally {
	/**
	 * A run this long without a single success is not bad luck. An unlicensed mailbox answers
	 * `failedPrecondition` for every message, and skipping thousands of them one at a time — each
	 * with its own retries and backoff — would look like progress while achieving nothing. Aborting
	 * puts the real problem in the source's status instead.
	 */
	static readonly MAX_CONSECUTIVE_FAILURES = 10;
	static readonly MAX_SAMPLES = 5;

	#count = 0;
	#consecutive = 0;
	#samples: string[] = [];

	/** Clears the consecutive run. Call this after anything that was not a failure. */
	public succeeded(): void {
		this.#consecutive = 0;
	}

	/** Records a skipped message, and throws once the failures look mailbox-wide. */
	public record(subject: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.#count++;
		this.#consecutive++;
		if (this.#samples.length < MessageFailureTally.MAX_SAMPLES) {
			this.#samples.push(`${subject}: ${message}`);
		}
		if (this.#consecutive >= MessageFailureTally.MAX_CONSECUTIVE_FAILURES) {
			throw new Error(
				`Aborted after ${this.#consecutive} consecutive failures with no success in between, which points at a mailbox-wide problem rather than isolated bad responses. Last error: ${message}`
			);
		}
	}

	public get result(): { count: number; samples: string[] } {
		return { count: this.#count, samples: [...this.#samples] };
	}
}
