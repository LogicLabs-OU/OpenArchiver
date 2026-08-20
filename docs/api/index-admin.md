---
aside: false
---

# Index Admin API

Observability and maintenance for the search engine (Meilisearch). These endpoints power the **Admin → Index** page and are intended for troubleshooting indexing. All routes require `manage:all` (Super Administrator) permission, and the API key of the search engine is never returned.

## Get Overview

Returns instance-level information (host, version, health, database size), metadata for the `emails` index (document count, primary key, indexing state, field distribution), and per-ingestion-source document counts taken directly from the search index's facet distribution — not the database.

<OAOperation operationId="getSearchIndexOverview" />

## Get Tasks

Returns a cursor-paginated list of Meilisearch tasks for the `emails` index (e.g. `documentAdditionOrUpdate`), including status, received/indexed document counts, duration, timestamps, and any error. Filter with `statuses` and `types`, and page with `limit` + `from` (use the `next` cursor from the previous response).

<OAOperation operationId="getSearchIndexTasks" />

## Clean Up Orphaned Documents

Queues a background sweep that removes documents from the `emails` index whose archived email no longer exists in the database.

These entries are left behind when a deletion removes the database row but its search index counterpart never completes — for example if the search engine was unavailable at the time. They appear to users as search results that cannot be opened. The sweep clears whole blocks first, for ingestion sources that were deleted, then compares the remaining document ids against the database one page at a time.

No emails, attachments or stored files are touched: the database and the stored `.eml` files are the archive's source of truth, and the index is rebuilt from them by a reindex. The response reports the surplus of index documents over archived emails as `estimatedOrphans`, which is a floor rather than an exact figure — emails archived but not yet indexed offset orphans one for one. The exact number removed is written to the worker log and the job's result on **Admin → Jobs**.

Only one sweep runs at a time. A request made while one is already queued or running joins it instead of starting a second, and says so via `alreadyRunning` in the response. Once a sweep has finished, the action can be triggered again — including after a failed run.

<OAOperation operationId="cleanupOrphanedIndexDocuments" />
