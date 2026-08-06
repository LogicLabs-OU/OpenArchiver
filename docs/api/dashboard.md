---
aside: false
---

# Dashboard API

Aggregated statistics and summaries for the dashboard UI. Requires `read:dashboard` permission.

## Get Stats

<OAOperation operationId="getDashboardStats" />

## Get Ingestion History

<OAOperation operationId="getIngestionHistory" />

## Get Ingestion Source Summaries

<OAOperation operationId="getDashboardIngestionSources" />

## Get Recent Syncs

<OAOperation operationId="getRecentSyncs" />

## Get Indexed Email Insights

<OAOperation operationId="getIndexedInsights" />

## Get Index Health

Global index health — the total number of archived emails in the database versus the number of documents in the search index. A gap indicates emails missing from search.

<OAOperation operationId="getIndexHealth" />
