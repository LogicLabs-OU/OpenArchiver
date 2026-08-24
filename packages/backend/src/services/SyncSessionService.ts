import { db } from '../database';
import { syncSessions, ingestionSources } from '../database/schema';
import { and, eq, inArray, lt, notExists, sql, type SQL } from 'drizzle-orm';
import type { SyncState, ProcessMailboxError, ProcessMailboxSkip } from '@open-archiver/types';
import { logger } from '../config/logger';
import { ingestionQueue } from '../jobs/queues';
import { isJobLive } from '../jobs/helpers/claimJobId';
import { continuousSyncJobId, initialImportJobId } from '../jobs/helpers/jobIds';

/** Top-level SyncState keys whose value is a per-mailbox map and so must merge, not replace. */
const NESTED_STATE_KEYS = new Set(['google', 'microsoft', 'imap']);

/**
 * The expression that folds one mailbox's sync state into the source's stored state.
 *
 * jsonb `||` is a shallow concat: writing `{ microsoft: { alice: ... } }` replaces the whole
 * `microsoft` object, so with N mailboxes reporting in only the last job's tokens would survive
 * and every other mailbox would re-enumerate on the next cycle. Concatenating inside each provider
 * bucket keeps the other mailboxes' entries; scalar keys such as `lastSyncTimestamp` and
 * `statusMessage` are meant to replace, so they stay on a plain top-level concat.
 *
 * Built as one expression rather than a read-modify-write because process-mailbox jobs run
 * concurrently — reading the column in JS would need `SELECT ... FOR UPDATE` to avoid lost updates.
 * The `->` reads the pre-update row, which is what an UPDATE SET expression sees.
 */
const buildSyncStateMerge = (state: SyncState): SQL => {
	let expression: SQL = sql`COALESCE(${ingestionSources.syncState}, '{}'::jsonb)`;
	const scalars: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(state)) {
		if (NESTED_STATE_KEYS.has(key) && value && typeof value === 'object') {
			// Both keys carry an explicit ::text — `jsonb -> $n` with an untyped parameter is
			// ambiguous between the text and integer forms of the operator and fails to resolve.
			expression = sql`${expression} || jsonb_build_object(${key}::text, COALESCE(${ingestionSources.syncState} -> ${key}::text, '{}'::jsonb) || ${JSON.stringify(value)}::jsonb)`;
		} else {
			scalars[key] = value;
		}
	}

	if (Object.keys(scalars).length > 0) {
		expression = sql`${expression} || ${JSON.stringify(scalars)}::jsonb`;
	}

	return expression;
};

export interface SyncSessionRecord {
	id: string;
	ingestionSourceId: string;
	isInitialImport: boolean;
	totalMailboxes: number;
	completedMailboxes: number;
	failedMailboxes: number;
	errorMessages: string[];
	createdAt: Date;
	lastActivityAt: Date;
}

export interface MailboxResultOutcome {
	/** True if this was the last mailbox job in the session (should trigger finalization) */
	isLast: boolean;
	totalCompleted: number;
	totalFailed: number;
	errorMessages: string[];
}

export class SyncSessionService {
	/**
	 * Creates a new sync session for a given ingestion source and returns its ID.
	 * Must be called before any process-mailbox jobs are dispatched.
	 */
	public static async create(
		ingestionSourceId: string,
		totalMailboxes: number,
		isInitialImport: boolean
	): Promise<string> {
		const [session] = await db
			.insert(syncSessions)
			.values({
				ingestionSourceId,
				totalMailboxes,
				isInitialImport,
				completedMailboxes: 0,
				failedMailboxes: 0,
				errorMessages: [],
			})
			.returning({ id: syncSessions.id });

		logger.info(
			{ sessionId: session.id, ingestionSourceId, totalMailboxes, isInitialImport },
			'Sync session created'
		);

		return session.id;
	}

	/**
	 * Atomically records the result of a single process-mailbox job.
	 * Increments either completedMailboxes or failedMailboxes depending on the result.
	 * If the result is a successful SyncState, it is merged into the ingestion source's
	 * syncState column using PostgreSQL's jsonb merge operator.
	 *
	 * A third outcome sits between the two: a SKIP, for a directory entry with no mailbox to
	 * read (see ProcessMailboxSkip). It counts as completed — nothing failed, and the cycle
	 * must be allowed to end in success — while its reason is appended to the same message
	 * array a failure uses, so the finalizer can repeat it without a schema change. The array
	 * is therefore "notes about this cycle", of which errors are one kind; `failedMailboxes`
	 * alone decides whether the cycle failed.
	 *
	 * Returns whether this was the last mailbox job in the session.
	 */
	public static async recordMailboxResult(
		sessionId: string,
		result: SyncState | ProcessMailboxError | ProcessMailboxSkip
	): Promise<MailboxResultOutcome> {
		const isError = (result as ProcessMailboxError).error === true;
		const isSkip = (result as ProcessMailboxSkip).skipped === true;
		const note = isError || isSkip ? (result as { message: string }).message : null;

		// Atomically increment the appropriate counter and append the note if there is one.
		// The RETURNING clause ensures we get the post-update values to check if this is the last job.
		const [updated] = await db
			.update(syncSessions)
			.set({
				completedMailboxes: isError
					? syncSessions.completedMailboxes
					: sql`${syncSessions.completedMailboxes} + 1`,
				failedMailboxes: isError
					? sql`${syncSessions.failedMailboxes} + 1`
					: syncSessions.failedMailboxes,
				errorMessages:
					note !== null
						? sql`array_append(${syncSessions.errorMessages}, ${note})`
						: syncSessions.errorMessages,
				// Touch lastActivityAt on every result so the stale-session detector
				// knows this session is still alive, regardless of how long it has been running.
				lastActivityAt: new Date(),
			})
			.where(eq(syncSessions.id, sessionId))
			.returning({
				completedMailboxes: syncSessions.completedMailboxes,
				failedMailboxes: syncSessions.failedMailboxes,
				totalMailboxes: syncSessions.totalMailboxes,
				errorMessages: syncSessions.errorMessages,
				ingestionSourceId: syncSessions.ingestionSourceId,
			});

		if (!updated) {
			throw new Error(`Sync session ${sessionId} not found when recording mailbox result.`);
		}

		// If the result is a successful SyncState with actual content, merge it into the
		// ingestion source's syncState column in Postgres. This is done incrementally per mailbox
		// to avoid the large deepmerge at the end — see buildSyncStateMerge for why the merge has
		// to reach one level below the top.
		// A skip is excluded as firmly as an error: its object is {skipped, message}, not sync
		// state, and merging it would write those two keys into the source's syncState column.
		if (!isError && !isSkip) {
			const syncState = result as SyncState;
			if (Object.keys(syncState).length > 0) {
				await db
					.update(ingestionSources)
					.set({ syncState: buildSyncStateMerge(syncState) })
					.where(eq(ingestionSources.id, updated.ingestionSourceId));
			}
		}

		const totalProcessed = updated.completedMailboxes + updated.failedMailboxes;
		const isLast = totalProcessed >= updated.totalMailboxes;

		logger.info(
			{
				sessionId,
				completed: updated.completedMailboxes,
				failed: updated.failedMailboxes,
				total: updated.totalMailboxes,
				isLast,
			},
			'Mailbox result recorded'
		);

		return {
			isLast,
			totalCompleted: updated.completedMailboxes,
			totalFailed: updated.failedMailboxes,
			errorMessages: updated.errorMessages,
		};
	}

	/**
	 * Fetches a sync session by its ID.
	 */
	public static async findById(sessionId: string): Promise<SyncSessionRecord> {
		const [session] = await db
			.select()
			.from(syncSessions)
			.where(eq(syncSessions.id, sessionId));

		if (!session) {
			throw new Error(`Sync session ${sessionId} not found.`);
		}

		return session;
	}

	/**
	 * Updates lastActivityAt for the session without changing any counters.
	 * Should be called periodically during a long-running process-mailbox job
	 * to prevent cleanStaleSessions() from incorrectly treating an actively
	 * processing mailbox as stale.
	 *
	 */
	public static async heartbeat(sessionId: string): Promise<void> {
		try {
			await db
				.update(syncSessions)
				.set({ lastActivityAt: new Date() })
				.where(eq(syncSessions.id, sessionId));
		} catch (error) {
			logger.warn({ err: error, sessionId }, 'Failed to update session heartbeat');
		}
	}

	/**
	 * Deletes a sync session after finalization to keep the table clean.
	 */
	public static async finalize(sessionId: string): Promise<void> {
		await db.delete(syncSessions).where(eq(syncSessions.id, sessionId));
		logger.info({ sessionId }, 'Sync session finalized and deleted');
	}

	/**
	 * Finds all sync sessions that are stale and marks the associated ingestion source
	 * as 'error', then deletes the orphaned session row.
	 *
	 * Staleness is determined by lastActivityAt — the timestamp updated every time a
	 * process-mailbox job reports a result. This correctly handles large imports that run
	 * for many hours: as long as mailboxes are actively completing, lastActivityAt stays
	 * fresh and the session is never considered stale.
	 *
	 * A session is stale when:
	 *   completedMailboxes + failedMailboxes < totalMailboxes
	 *   AND lastActivityAt < (now - thresholdMs)
	 *
	 * Default threshold: 30 minutes of inactivity. This covers the crash scenario where
	 * the processor died after creating the session but before all process-mailbox jobs
	 * were enqueued — those jobs will never report back, causing permanent inactivity.
	 *
	 * Once cleaned up, the source is set to 'error' so the next scheduler tick will
	 * re-queue a continuous-sync job.
	 */
	public static async cleanStaleSessions(
		thresholdMs: number = 30 * 60 * 1000 // 30 minutes of inactivity
	): Promise<void> {
		const cutoffTime = new Date(Date.now() - thresholdMs);

		// Find sessions with no recent activity (regardless of how old they are)
		const staleSessions = await db
			.select()
			.from(syncSessions)
			.where(lt(syncSessions.lastActivityAt, cutoffTime));

		for (const session of staleSessions) {
			const totalProcessed = session.completedMailboxes + session.failedMailboxes;
			if (totalProcessed >= session.totalMailboxes) {
				// Every mailbox reported, but the sync-cycle-finished job never ran — it was lost,
				// or the worker died between the last result and dispatching it. Deleting the row
				// and walking away used to leave the source in 'syncing' with nothing left to move
				// it: the scheduler only selects 'active'/'error', so it silently stopped syncing
				// and drifted behind its siblings for as long as nobody noticed. Re-dispatching the
				// finalizer instead lets the normal path set the status, message and counters.
				await ingestionQueue.add(
					'sync-cycle-finished',
					{
						ingestionSourceId: session.ingestionSourceId,
						sessionId: session.id,
						isInitialImport: session.isInitialImport,
					},
					// Keyed on the session so repeated sweeps cannot pile up finalizers for it. The
					// session row is deleted whichever way the finalizer ends, so this cannot become
					// a sweep that re-dispatches the same lost job forever.
					{
						jobId: `sync-cycle-finished:${session.id}`,
						removeOnComplete: true,
						removeOnFail: true,
					}
				);
				logger.warn(
					{ sessionId: session.id, ingestionSourceId: session.ingestionSourceId },
					'Re-dispatched sync-cycle-finished for a completed-but-unfinalized sync session'
				);
				continue;
			}

			// Session is genuinely stuck — no mailbox activity for the threshold period.
			const inactiveMinutes = Math.round(
				(Date.now() - session.lastActivityAt.getTime()) / 60000
			);

			logger.warn(
				{
					sessionId: session.id,
					ingestionSourceId: session.ingestionSourceId,
					totalMailboxes: session.totalMailboxes,
					completedMailboxes: session.completedMailboxes,
					failedMailboxes: session.failedMailboxes,
					inactiveMinutes,
				},
				'Stale sync session detected — marking source as error and cleaning up'
			);

			await db
				.update(ingestionSources)
				.set({
					status: 'error',
					lastSyncFinishedAt: new Date(),
					lastSyncStatusMessage: `Sync interrupted: no activity for ${inactiveMinutes} minutes. ${session.completedMailboxes} of ${session.totalMailboxes} mailboxes completed. Will retry on next sync cycle.`,
				})
				.where(eq(ingestionSources.id, session.ingestionSourceId));

			await db.delete(syncSessions).where(eq(syncSessions.id, session.id));

			logger.info(
				{ sessionId: session.id, ingestionSourceId: session.ingestionSourceId },
				'Stale sync session cleaned up, source set to error for retry'
			);
		}

		await this.releaseSessionlessSources(thresholdMs);
	}

	/**
	 * Frees sources left mid-cycle with no session row to account for them.
	 *
	 * The sweep above can only see sources a session points at, and there is a window with no
	 * session at all: both master jobs claim the source ('syncing' / 'importing') before
	 * SyncSessionService.create() runs, so a worker that dies in between — an OOM kill, a deploy, a
	 * lost Redis connection — leaves the source claimed and nothing anywhere referring to it. The
	 * scheduler only selects 'active' and 'error', so that source silently stopped syncing and
	 * drifted further behind its siblings every day while the UI still displayed "syncing". Three
	 * sources on the dev instance had been wedged this way for four months.
	 *
	 * Setting them to 'error' is what puts them back in the scheduler's reach; the next tick
	 * re-syncs them and dedup skips everything already archived.
	 *
	 * The threshold is shared with the session sweep and measured from lastSyncStartedAt, so a cycle
	 * whose enumeration phase legitimately runs long is not cut off — and if one ever exceeds it,
	 * claimForSync is what stops the second cycle from doing damage.
	 */
	private static async releaseSessionlessSources(thresholdMs: number): Promise<void> {
		const cutoffTime = new Date(Date.now() - thresholdMs);

		// Selected first, then filtered, then released. An UPDATE straight from the predicate would
		// be one statement fewer, but it cannot ask the queue whether the master job is still alive,
		// and releasing a source whose job is still running is what re-opens the very window this
		// changeset closes — see below.
		const candidates = await db
			.select({ id: ingestionSources.id, name: ingestionSources.name })
			.from(ingestionSources)
			.where(
				and(
					inArray(ingestionSources.status, ['syncing', 'importing']),
					lt(ingestionSources.lastSyncStartedAt, cutoffTime),
					notExists(
						db
							.select({ one: sql`1` })
							.from(syncSessions)
							.where(eq(syncSessions.ingestionSourceId, ingestionSources.id))
					)
				)
			);

		for (const source of candidates) {
			// Both master jobs create their session only after enumerating mailboxes, so a tenant
			// whose enumeration runs past the threshold looks exactly like an abandoned one from the
			// database alone. Releasing it to 'error' would let the scheduler start a competing
			// cycle: a continuous sync is protected by its shared job id, which the still-active job
			// holds, but an initial import is a different job under a different id and nothing would
			// absorb the add — two cycles over the same mailboxes, the overlap that duplicates mail.
			//
			// Probing the ids answers the question the timestamp cannot. It is also self-correcting:
			// a process that died leaves its job to be failed by the stalled-job check well inside
			// this threshold (maxStalledCount 0, ten-minute lock), after which it is no longer live
			// and the rescue proceeds as intended.
			const [importing, syncing] = await Promise.all([
				isJobLive(ingestionQueue, initialImportJobId(source.id)),
				isJobLive(ingestionQueue, continuousSyncJobId(source.id)),
			]);

			if (importing || syncing) {
				logger.info(
					{ ingestionSourceId: source.id, name: source.name },
					'Source has no sync session yet, but its master job is still running - leaving it alone'
				);
				continue;
			}

			await db
				.update(ingestionSources)
				.set({
					status: 'error',
					lastSyncFinishedAt: new Date(),
					lastSyncStatusMessage:
						'Sync interrupted before it started reporting progress, and no sync session was found. Will retry on the next sync cycle.',
				})
				.where(eq(ingestionSources.id, source.id));

			logger.warn(
				{ ingestionSourceId: source.id, name: source.name },
				'Source was stuck mid-cycle with no sync session - set to error so the scheduler retries it'
			);
		}
	}
}
