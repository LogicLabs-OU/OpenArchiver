---
aside: false
---

# Search API

Full-text search over indexed archived emails, powered by Meilisearch.

## Search Emails

<OAOperation operationId="searchEmails" />

## Suggest Facet Values (Typeahead)

Returns prefix-matched, permission-scoped values for a facet field — used to power the mailbox and sender autocomplete in the advanced search filters. A partial token such as `gmail` suggests full addresses like `abc@gmail.com`, and results respect the caller's permissions.

<OAOperation operationId="searchFacetValues" />
