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
| `INGESTION_EMAIL_CONCURRENCY`  | `3`         | Emails archived at once within one mailbox            |
| `INDEXING_WORKER_CONCURRENCY`  | `4`         | Number of indexing jobs that run in parallel          |
| `MEILI_INDEXING_BATCH`         | `500`       | Number of emails per `index-email-batch` job          |
| `MEILI_INDEXING_CHUNK`         | `25`        | Documents built and sent to Meilisearch at a time     |
| `INDEXING_MAX_TEXT_BYTES`      | `1000000`   | Extracted text kept per attachment and per body       |
| `MAX_INDEX_ATTEMPTS`           | `8`         | Failed attempts before an email is left out of search |

### Tuning ingestion concurrency

Two settings, one across mailboxes and one within a mailbox, and they multiply.

`INGESTION_WORKER_CONCURRENCY` is how many mailboxes sync at the same time. Increase it on servers with more RAM to reduce total sync time.

`INGESTION_EMAIL_CONCURRENCY` is how many emails one mailbox archives at the same time. Archiving an email is a download followed by a storage write and a handful of database writes; run strictly one at a time, the connector idles through every write and the writes idle through every download. This overlaps them, and it is the setting to raise when a single large mailbox is the thing taking all night.

Deduplication stays correct regardless of the value: messages sharing a Message-ID are serialised within the mailbox, so the check-then-insert dedup gate never runs against itself. Sources with **Preserve Original File** (GoBD) enabled also dedup on a content hash, which is what catches byte-identical messages whose Message-ID is missing — those have no shared key to serialise on, so in that mode every message without a Message-ID is processed one at a time instead.

The two multiply for memory: a worker can hold `INGESTION_WORKER_CONCURRENCY` × `INGESTION_EMAIL_CONCURRENCY` emails' attachment buffers at once, and unlike the indexing worker this process runs without a heap ceiling. Raise in small steps.

### Tuning indexing memory

Two settings look similar and do different jobs.

`MEILI_INDEXING_CHUNK` is the memory dial. Building a document reads the whole `.eml` from storage, parses it, and extracts the text of every attachment, so this is the number of those that are resident at once. It is what to reduce when the indexing worker is under memory pressure — a deployment with large attachments may want 10 or less.

`MEILI_INDEXING_BATCH` is queue granularity: how many email ids travel in one job. It does **not** drive memory, because a job processes its ids one chunk at a time. It does drive self-healing throughput, since the reconcile pass enqueues at most `INDEX_RECONCILE_PAGE_CAP` **jobs** per tick — so lowering it lowers how fast a backlog drains.

`INDEXING_WORKER_CONCURRENCY` is how many jobs run at once, and it is usually the setting that decides throughput. Most of a job's wall clock is spent waiting rather than computing: a storage read per email, then a Meilisearch task the job must see finish before it may mark those emails indexed. Left at one job at a time — the previous behaviour — that wait was dead time, and a backlog drained at a fixed rate no matter how large the host was.

`INDEXING_WORKER_MAX_OLD_SPACE_MB` (default `2048`) sets the worker's V8 heap ceiling. An explicit limit makes V8 collect harder as it approaches the limit rather than sizing itself from host RAM.

Peak indexing memory has two terms:

- **Built documents** — roughly `INDEXING_WORKER_CONCURRENCY` × 2 × `MEILI_INDEXING_CHUNK` × `INDEXING_MAX_TEXT_BYTES`. The factor of two is the pipeline: while one chunk's write is settling at Meilisearch, the next chunk is already being built.
- **Raw buffers** — the `.eml` and attachment bytes of the documents currently being built, each fully in memory while it is parsed and its text extracted. This is bounded process-wide rather than per job: the per-job build pool is divided by `INDEXING_WORKER_CONCURRENCY`, so about ten documents build at once whatever the concurrency, and raising the concurrency does not multiply this term.

When raising concurrency, raise the heap ceiling or lower the chunk to match the first term. Both settings are capped at 32; a value above that, or one that is not a plain integer (`1_000`, `10k`), is rejected with a warning and the default used instead.

## Resilience

- **Job retries:** All jobs are configured with 5 retry attempts using exponential backoff (starting at 1 second). This handles transient API failures from email providers.
- **Worker crash recovery:** BullMQ detects stalled jobs (no heartbeat within `lockDuration`) and re-queues them automatically. On retry, already-processed emails are skipped via `checkDuplicate()`.
- **Partial sync recovery:** Stale session detection handles the case where a worker crashes mid-dispatch, leaving some mailboxes never enqueued. The source is reset to `error` and the next scheduler tick retries the full sync.
