# Job Queue Service

This document describes the architecture of the job queue system, including the sync cycle coordination mechanism and relevant configuration options.

## Architecture

The job queue system is built on [BullMQ](https://docs.bullmq.io/) backed by Redis (Valkey). Two worker processes run independently:

- **Ingestion worker** (`ingestion.worker.ts`) — processes the `ingestion` queue
- **Indexing worker** (`indexing.worker.ts`) — processes the `indexing` queue

### Queues

| Queue       | Jobs                                                                                                      | Purpose                                |
| ----------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `ingestion` | `schedule-continuous-sync`, `continuous-sync`, `initial-import`, `process-mailbox`, `sync-cycle-finished` | Email ingestion and sync orchestration |
| `indexing`  | `index-email-batch`                                                                                       | Meilisearch document indexing          |

### Job Flow

```
[schedule-continuous-sync] (repeating cron)
    └→ [continuous-sync] (per ingestion source)
           └→ [process-mailbox] × N (one per user mailbox)
                  └→ [index-email-batch] (batched, on indexing queue)
                  └→ [sync-cycle-finished] (dispatched by the last mailbox job)
```

For initial imports, `initial-import` triggers the same `process-mailbox` → `sync-cycle-finished` flow.

## Sync Cycle Coordination

Sync cycle completion (knowing when all mailboxes in a sync have finished) is coordinated via the `sync_sessions` PostgreSQL table rather than BullMQ's built-in flow/parent-child system.

**Why:** BullMQ's `FlowProducer` stores the entire parent/child relationship in Redis atomically. For large tenants with thousands of mailboxes, this creates large Redis writes and requires loading all child job return values into memory at once for aggregation.

**How it works:**

1. When `initial-import` or `continuous-sync` starts, it creates a `sync_sessions` row with `total_mailboxes = N`.
2. Each `process-mailbox` job atomically increments `completed_mailboxes` or `failed_mailboxes` when it finishes, and merges its `SyncState` into `ingestion_sources.sync_state` using PostgreSQL's `||` jsonb operator.
3. The job that brings `completed + failed` to equal `total` dispatches the `sync-cycle-finished` job.
4. `sync-cycle-finished` reads the aggregated results from the session row and finalizes the source status.
5. The session row is deleted after finalization.

### Session Heartbeat

Each `process-mailbox` job updates `last_activity_at` on the session every time it flushes an email batch to the indexing queue. This prevents the stale session detector from treating an actively processing large mailbox as stuck.

### Stale Session Detection

The `schedule-continuous-sync` job runs `SyncSessionService.cleanStaleSessions()` on every tick. A session is considered stale when `last_activity_at` has not been updated for 30 minutes, indicating the worker that created it has crashed before all mailbox jobs were enqueued.

When a stale session is detected:

1. The associated ingestion source is set to `status: 'error'` with a descriptive message.
2. The session row is deleted.
3. On the next scheduler tick, the source is picked up as an `error` source and a new `continuous-sync` job is dispatched.

Already-ingested emails from the partial sync are preserved. The next sync skips them via duplicate detection (`checkDuplicate()`).

## Configuration

| Environment Variable           | Default     | Description                                           |
| ------------------------------ | ----------- | ----------------------------------------------------- |
| `SYNC_FREQUENCY`               | `* * * * *` | Cron pattern for continuous sync scheduling           |
| `INGESTION_WORKER_CONCURRENCY` | `5`         | Number of `process-mailbox` jobs that run in parallel |
| `MEILI_INDEXING_BATCH`         | `500`       | Number of emails per `index-email-batch` job          |

### Tuning `INGESTION_WORKER_CONCURRENCY`

Each `process-mailbox` job holds at most one parsed email in memory at a time during the ingestion loop. At typical email sizes (~50KB average), memory pressure per concurrent job is low. Increase this value on servers with more RAM to process multiple mailboxes in parallel and reduce total sync time.

### Tuning `MEILI_INDEXING_BATCH`

Each `index-email-batch` job loads the `.eml` file and all attachments from storage into memory for text extraction before sending to Meilisearch. Reduce this value if the indexing worker experiences memory pressure on deployments with large attachments.

## Resilience

- **Job retries:** All jobs are configured with 5 retry attempts using exponential backoff (starting at 1 second). This handles transient API failures from email providers.
- **Worker crash recovery:** BullMQ detects stalled jobs (no heartbeat within `lockDuration`) and re-queues them automatically. On retry, already-processed emails are skipped via `checkDuplicate()`.
- **Partial sync recovery:** Stale session detection handles the case where a worker crashes mid-dispatch, leaving some mailboxes never enqueued. The source is reset to `error` and the next scheduler tick retries the full sync.
