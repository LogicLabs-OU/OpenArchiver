---
aside: false
---

# Index Admin API

Read-only observability for the search engine (Meilisearch). These endpoints power the **Admin → Index** page and are intended for troubleshooting indexing. All routes require `manage:all` (Super Administrator) permission and expose only `GET` methods — the API key of the search engine is never returned.

## Get Overview

Returns instance-level information (host, version, health, database size), metadata for the `emails` index (document count, primary key, indexing state, field distribution), and per-ingestion-source document counts taken directly from the search index's facet distribution — not the database.

<OAOperation operationId="getSearchIndexOverview" />

## Get Tasks

Returns a cursor-paginated list of Meilisearch tasks for the `emails` index (e.g. `documentAdditionOrUpdate`), including status, received/indexed document counts, duration, timestamps, and any error. Filter with `statuses` and `types`, and page with `limit` + `from` (use the `next` cursor from the previous response).

<OAOperation operationId="getSearchIndexTasks" />
