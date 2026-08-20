/**
 * The BullMQ job id a source's continuous-sync cycle runs under.
 *
 * Shared by the scheduler and by a user-triggered force sync so the two cannot dispatch competing
 * cycles for the same source: BullMQ drops an add whose id already exists, which is what keeps one
 * cycle per source no matter how many dispatchers a deployment ends up with.
 */
export const continuousSyncJobId = (ingestionSourceId: string): string =>
	`continuous-sync:${ingestionSourceId}`;

/**
 * The BullMQ job id a source's initial import runs under.
 *
 * Two purposes, both needed. It keeps a second import of the same source from being queued beside a
 * running one, and it gives the stale-source rescue something to ask: a source claimed as
 * `importing` with no session yet is indistinguishable from an abandoned one unless the master job
 * can be probed by id. See `SyncSessionService.releaseSessionlessSources`.
 */
export const initialImportJobId = (ingestionSourceId: string): string =>
	`initial-import:${ingestionSourceId}`;
