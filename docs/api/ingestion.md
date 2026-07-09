---
aside: false
---

# Ingestion API

Manage ingestion sources — the configured connections to email providers (Google Workspace, Microsoft 365, IMAP, and file imports). Credentials are never returned in responses.

## Create an Ingestion Source

<OAOperation operationId="createIngestionSource" />

## List Ingestion Sources

<OAOperation operationId="listIngestionSources" />

## Get an Ingestion Source

<OAOperation operationId="getIngestionSourceById" />

## Update an Ingestion Source

<OAOperation operationId="updateIngestionSource" />

## Delete an Ingestion Source

<OAOperation operationId="deleteIngestionSource" />

## Trigger Initial Import

<OAOperation operationId="triggerInitialImport" />

## Pause an Ingestion Source

<OAOperation operationId="pauseIngestionSource" />

## Force Sync

<OAOperation operationId="triggerForceSync" />

## Reindex an Ingestion Source

Rebuilds the search-index documents for a source (and its whole merge group) from the archived emails already in the database — it never re-downloads or re-ingests, and it never creates duplicate documents (Meilisearch is keyed by the email ID, so re-adding upserts). Send `{"mode": "full"}` to rebuild every document, or omit it (default `missing`) to only index emails not yet in the index.

<OAOperation operationId="reindexIngestionSource" />

## Reindex All Sources

Enqueues a reindex across every ingestion source. Requires `manage:ingestion`.

<OAOperation operationId="reindexAllIngestionSources" />

## Get Index Health

Compares the number of archived emails in the database against the number of documents in the search index for a source (and its merge group). A gap means some emails are missing from search and can be repaired with a reindex.

<OAOperation operationId="getIngestionSourceIndexHealth" />

## Get Statistics

Read-only statistics for a source (and its merge group): email/mailbox/thread counts, storage usage (email + attachment bytes, deduplicated), index coverage, attachment and compliance counts, a per-mailbox breakdown, merge-group children, and recent activity.

<OAOperation operationId="getIngestionSourceStats" />

## Unmerge an Ingestion Source

<OAOperation operationId="unmergeIngestionSource" />
