import { db } from '../database';
import { syncSessions, ingestionSources } from '../database/schema';
import { eq, lt, sql } from 'drizzle-orm';
import type { SyncState, ProcessMailboxError } from '@open-archiver/types';
import { logger } from '../config/logger';

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
	 * Returns whether this was the last mailbox job in the session.
	 */
	public static async recordMailboxResult(
		sessionId: string,
		result: SyncState | ProcessMailboxError
	): Promise<MailboxResultOutcome> {
		const isError = (result as ProcessMailboxError).error === true;

		// Atomically increment the appropriate counter and append error message if needed.
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
				errorMessages: isError
					? sql`array_append(${syncSessions.errorMessages}, ${(result as ProcessMailboxError).message})`
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
		// ingestion source's syncState column using PostgreSQL's || jsonb merge operator.
		// This is done incrementally per mailbox to avoid the large deepmerge at the end.
		if (!isError) {
			const syncState = result as SyncState;
			if (Object.keys(syncState).length > 0) {
				await db
					.update(ingestionSources)
					.set({
						syncState: sql`COALESCE(${ingestionSources.syncState}, '{}'::jsonb) || ${JSON.stringify(syncState)}::jsonb`,
					})
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
			logger.info('heatbeat, ', sessionId);
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
				// Session finished but was never finalized (e.g., sync-cycle-finished job
				// was lost) — clean it up silently without touching the source status.
				await db.delete(syncSessions).where(eq(syncSessions.id, session.id));
				logger.warn(
					{ sessionId: session.id, ingestionSourceId: session.ingestionSourceId },
					'Cleaned up completed-but-unfinalized stale sync session'
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
	}
}
