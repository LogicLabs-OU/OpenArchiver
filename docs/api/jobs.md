---
aside: false
---

# Jobs API

Monitor BullMQ job queues for asynchronous tasks such as email ingestion, indexing, and sync scheduling. Requires Super Admin (`manage:all`) permission.

There are two queues:

- **`ingestion`** — handles all email ingestion and sync jobs (`initial-import`, `continuous-sync`, `process-mailbox`, `sync-cycle-finished`, `schedule-continuous-sync`)
- **`indexing`** — handles batched Meilisearch document indexing (`index-email-batch`)

## List All Queues

<OAOperation operationId="getQueues" />

## Get Jobs in a Queue

<OAOperation operationId="getQueueJobs" />
