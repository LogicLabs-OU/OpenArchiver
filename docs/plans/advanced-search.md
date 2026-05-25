# Advanced Search — Master Implementation Plan

**Umbrella issue:** https://github.com/LogicLabs-OU/OpenArchiver/issues/381
**Status:** Plan — no code shipped yet.
**Owners (suggested):** backend lead for P1–P3, frontend lead for P4–P6, ops for the P2 backfill rollout.

This document is the integration layer over four sub-plans (P1, P2, P3, P4/P5/P6).
It captures **cross-cutting decisions**, the **PR sequence**, **what each PR must do that the per-PR plan does not own**, and the **rollout checklist**. The sub-plans are the source of truth for in-PR implementation detail.

---

## 1. The slices

| Slice | Scope | Closes | Risk |
|------:|-------|--------|------|
| **P0** | Project plumbing: test runner, types-package rebuild discipline | — | Low |
| **P1** | Search API contract + plumbing: `POST /v1/search` with typed `filters`, allow filter-only search, hardened filter translator | #288 | Low–Medium (touches hot path) |
| **P2** | Original `Date` header integrity: helper, schema migration, connector fixes, backfill job | #372 | High (schema migration + long-running backfill) |
| **P3** | Meilisearch index expansion: `path`, `tags`, `hasAttachments`, `sizeBytes`, `isOnLegalHold`, `threadId`, `attachments.sha256`, `subject`/`from`/`sizeBytes` sortable; unified reindex orchestrator | partial #137 | Medium (settings task on large indexes; reindex load) |
| **P4** | Frontend advanced filter panel + URL state + result-card additions | #146, #244, #130, #40, #212 | Medium (large frontend surface) |
| **P5** | Sort control above results | #298, #304 | Low |
| **P6** | Persist matching-strategy default (localStorage v1) | #247 | Low |

Out of scope here, tracked elsewhere: #367 (semantic search), #294 (relative date on ingestion), #363 (Top Senders facet cap — folded into P3's `configureEmailIndex` change), #307 (autocomplete disable — small, ships independently).

---

## 2. Cross-cutting decisions (binding for all sub-plans)

These are the calls that resolve overlaps between the four sub-plans. The per-PR plans must conform to these.

### 2.1 Test infrastructure — added in P0, not P1

Every sub-plan flagged "no existing tests" and proposed adding its own runner. That fragments the test story across four PRs. Instead:

- **P0** adds `vitest` to both `packages/backend` and `packages/frontend` (config files only, plus one smoke test each).
- P1, P2, P3, P4 each then add tests against the existing runner. No PR has to litigate the test-framework choice.
- Playwright (frontend e2e) lands inside P4, gated on whether the reviewer wants it in the same PR or a follow-up.

### 2.2 Reindex orchestration vs. date backfill — two queues, not one

P3 owns the **reindex orchestrator** (`reindexQueue` + `ReindexService` + admin REST endpoints) — re-index any subset of `archived_emails` into Meilisearch.

P2 owns the **date backfill worker** (`dateBackfillQueue`) — re-parse `.eml` from storage, recompute `sentAt`/`originalDateSource`, then **chain into the reindex orchestrator** for changed rows by enqueueing onto `indexingQueue` (which both P2 and P3 share for the final index-write step).

Why two queues, not one:
- P2's worker is **storage-bound** (one `StorageService.get` per email — S3 or local disk read). Concurrency profile is different from CPU-bound reindex.
- P2 must be **independently pausable** without halting routine reindex.
- The orchestrator (P3) needs to be reusable for future backfills (e.g. P3's own "new fields only" backfill, future schema changes).

The `scope` parameter on P3's reindex job lets P2's worker request a focused reindex for just the changed IDs.

### 2.3 Filter schema must include `path.exclude` and dotted `attachments.sha256`

P4 needs both. P1's sub-plan did not include them. **P1 scope is amended to add:**

- `path` filter accepts an optional `exclude: string[]` at the filter top level (alongside `value`, `op`). The translator renders this as `NOT (path IN [...exclude])` ANDed into the clause.
- `attachments.sha256` is a top-level filter key in the typed `SearchFilters` interface. The translator renders it as `attachments.sha256 = '...'` (Meilisearch nested-array filter — already supported on v1.x).
- The `FIELD_KINDS` allowlist in `filterTranslator.ts` initially only declares `attachments.sha256` *after* P3 lands. Until then, `attachments.sha256` is rejected by the translator with the same "unknown field" error as `path`, `tags`, etc.

### 2.4 Field-availability gating — translator allowlist is the single source of truth

P1's `FilterTranslator` has a `FIELD_KINDS` map declaring which fields are currently filterable in Meilisearch. P3 expands the Meilisearch `filterableAttributes` and **must also extend `FIELD_KINDS`** in the same PR. Order: Meilisearch settings update → `FIELD_KINDS` update → reindex.

The `SearchQuery` type (in `@open-archiver/types`) declares the **full surface** including P3-only fields from day one, so frontend authors get typed access immediately. The translator is the runtime gate that 400s any field that isn't yet wired through.

### 2.5 `EmailDocument.timestamp` becomes optional (P2)

P2 changes `EmailDocument.timestamp: number` → `number | undefined` (field omitted entirely when unknown). This is a breaking change for anyone who reads the Meilisearch index outside of OpenArchiver's APIs. Documented in `CHANGELOG.md` under P2's release. P4 handles the undefined case in the result card.

### 2.6 `subject` filterability and sortability — P3 owns

P1 includes `subject` in the typed `SearchQuery` but rejects it at the translator (filterable only after P3). P3's `configureEmailIndex` adds `subject` to both `filterableAttributes` and `sortableAttributes`, and P3's PR extends `FIELD_KINDS` in the same change. P4's SortControl (`P5`) enables the "Subject A→Z" option only after P3 ships.

### 2.7 Type package release cadence

Monorepo workspace already wires `@open-archiver/types` via `workspace:*`. No npm publish needed per PR. Each PR that touches types also rebuilds the `types` package as part of the normal `pnpm -r build` step in CI. Downstream packages (`backend`, `frontend`) pick up the new types on the next build.

### 2.8 Migration discipline

P2 is the only PR with a schema migration. The deploy order is non-negotiable:

```
1. apply migration (sent_at NULL allowed, new columns)  ← non-breaking on its own
2. restart backend + workers with new code              ← starts writing null
3. trigger backfill via admin endpoint or CLI           ← long-running, pausable
```

P3 and P4 have no migrations. If P2 lands before P3/P4, no special ordering at deploy. If P3 lands before P2, that's also fine — P3 doesn't depend on `sentAt` nullability.

### 2.9 Settings task on large Meilisearch indexes (P3)

`configureEmailIndex` is called on every backend boot (`server.ts:96`). The first boot after P3 triggers a settings task that adds Roaring bitmap indexes for ~8 new filterable attributes. On indexes with >1M docs this can take several minutes. During that window:

- Search continues to work against the pre-P3 settings.
- Live ingestion continues to write documents (which now carry the new fields).
- New filter queries against the new attributes return empty until the settings task finishes AND the reindex job has run.

The CHANGELOG entry for P3 must call this out and recommend an off-peak deploy.

### 2.10 Stale references (P4 + backend)

A shared search URL containing an `ingestionSourceId` or `userEmail` that the current user can't see must **not** 403. Backend silently drops inaccessible filter values and searches the rest (CASL access-control filter is already AND-ed; an inaccessible source ID is effectively a no-op). P4 detects the drop client-side by comparing URL values against the `/ingestion-sources` list and surfaces a "Source no longer available" chip. **Confirm current backend behaviour during P1 implementation; file a small fix if it 403s today.**

---

## 3. PR sequence

The recommended landing order. Each row is one PR unless noted. PRs marked **(can ship in parallel)** are independent of any unmerged row above them.

| # | PR | Depends on | Notes |
|--:|----|-----------|-------|
| 0 | **P0** — vitest configs + smoke tests | — | One PR per package (or one bundled). No runtime change. |
| 1 | **P1** — POST /v1/search + filter translator | P0 for tests | Fixes #288. Includes `path.exclude` and `attachments.sha256` in the type surface, but translator gates both. |
| 2a | **P2-types** — types package only: nullable `sentAt`, optional `EmailDocument.timestamp`, new `originalDateSource` | P0 | Runtime no-op. Surfaces null-handling holes in downstream code via tsc. |
| 2b | **P2-migration** — Drizzle migration: `sent_at` nullable, add `original_date_source`, `date_backfilled_at` | P2-types | Deploy migration before P2-code. Non-breaking on its own. |
| 2c | **P2-code** — helper + connectors + IndexingService + IngestionService + frontend null handling | P2-types, P2-migration | After deploy, new emails get correct dates or null. Existing rows untouched until backfill runs. |
| 2d | **P2-backfill** — `dateBackfillQueue` + worker + CLI trigger | P2-code | Admin REST endpoints can defer to a follow-up; CLI is enough for the first deploy. |
| 3 | **P3** — index expansion + reindex orchestrator + admin REST endpoints | P0 (tests), P1 (filter translator allowlist extension) | Settings task triggers on boot; run reindex via the new admin endpoint to backfill new fields on old docs. Can ship in parallel with P2 (no overlap). |
| 4a | **P4-ui-primitives** — new shadcn wrappers (popover, calendar, range-calendar, date-picker, command, combobox, toggle-group, tabs, sheet, tooltip) | P0 | No business logic. Mechanical adaptation from bits-ui v2. |
| 4b | **P4-extract** — extract `SearchResults.svelte` from current `+page.svelte` with no behaviour change | P4-ui-primitives | Pure refactor, snapshot-tested. |
| 4c | **P4-state** — `url-state.ts` + `preferences.ts` (P6) + unit tests | P4-extract | No UI change; pure functions + localStorage. |
| 4d | **P4-panel** — `AdvancedFilters.svelte` shell + each filter component + result-card additions | P1, P3, P4-state | The big one. Land filter components in the order in P4 §17. |
| 4e | **P5** — SortControl above results | P3 (sortable attrs) | Single file + i18n. |
| 4f | **P4-e2e** — playwright happy-path | P4-panel | Optional, can defer. |

**Critical-path observations:**

- P2 and P3 can ship in parallel — they touch disjoint files except `IndexingService.createEmailDocument`, where a small merge is easy.
- P4 can begin (`4a`, `4b`, `4c`) before any backend PR lands. `4d` blocks on P1 and P3 (the API endpoint and the indexed fields).
- The fastest path to user-visible value: P0 → P1 → P3 → P4 (skipping P2). P2 can land anytime after P0 and before users notice date-collapse symptoms on bulk imports.

---

## 4. What each PR contributes to the umbrella

Pointers into the sub-plans. The master plan does not duplicate their detail.

- **P0** — this document, §6.1 (test config files).
- **P1** — sub-plan `Plan P1: filters API (#288)`. Sections of particular interest: §3 (`SearchQuery` shape), §4 (filter translator), §6 (zod schemas), §7 (CASL composition), §9 (OpenAPI), §13 (sequencing).
- **P2** — sub-plan `Plan P2: Date header fix (#372)`. Sections: §3 (`extractOriginalDate`), §6 (migration SQL), §10 (backfill job design), §13 (rollout order).
- **P3** — sub-plan `Plan P3: index expansion`. Sections: §1 (new `EmailDocument` shape), §2 (`configureEmailIndex` rewrite), §4 (settings task and reindex), §5 (attachment SHA semantics).
- **P4/P5/P6** — sub-plan `Plan P4: frontend advanced filter panel`. Sections: §1 (component tree), §2 (URL state), §3 (per-filter UX), §10 (sort), §11 (preference storage), §17 (sequencing).

---

## 5. Risk register (cross-PR)

Each risk is owned by the PR most able to address it. The master plan tracks them so they don't fall between PRs.

| ID | Risk | Owner | Mitigation |
|---:|------|-------|------------|
| R1 | Meilisearch settings task latency on large indexes | P3 | Off-peak deploy; documented in CHANGELOG. |
| R2 | Backfill load on storage layer | P2 | Default worker concurrency 1; pausable queue; admin warning when scan count >100k. |
| R3 | `EmailDocument.timestamp` nullable breaks external integrations | P2 | CHANGELOG; release-note callout. |
| R4 | Filter injection via raw user strings | P1 | Translator escapes single quotes; allowlists fields and ops; zod with `.strict()` rejects unknown keys. |
| R5 | Live ingestion vs. reindex race on the same document | P3 | Meili upsert by `id` is idempotent; whichever write lands last wins; documented. |
| R6 | Stale `ingestionSourceId` in shared URLs causes 403 | P1 backend, P4 frontend | Backend drops silently; frontend detects via `/ingestion-sources` list and offers to clear. |
| R7 | Retention math impossible when `sentAt` is null | P2 frontend | Render "Cannot compute scheduled deletion: original date unknown"; do NOT fall back to `archivedAt`. |
| R8 | URL length blow-up with many tags/paths | P4 | Soft warn at 6 KB; no truncation; POST body is the actual carrier. |
| R9 | Settings change race between two backend instances on boot | P3 | `updateSettings` is idempotent at Meili API level; multiple concurrent calls converge. No mitigation needed beyond awareness. |
| R10 | `bits-ui` v2 API drift vs. shadcn-svelte CLI templates | P4 | Budget half a day in `4a` for hand-tuning wrappers. |
| R11 | localStorage preference (P6) precedence with shared URLs | P6 | URL param always wins; documented in PR description. |
| R12 | Audit log spam if frontend live-applies on every keystroke | P4 | Apply is explicit (button or Enter), not live. Documented in P4 §3a. |

---

## 6. Rollout checklist

A checklist the deploying engineer can run through. Each box maps to a verifiable observation, not just a step.

### 6.1 P0
- [ ] `pnpm --filter @open-archiver/backend test` runs (even if zero tests pass).
- [ ] `pnpm --filter @open-archiver/frontend test` runs.
- [ ] CI workflow includes the new `test` step.

### 6.2 P1
- [ ] `POST /v1/search` with `{ "filters": { "from": { "op": "contains", "value": "@acme.com" } } }` returns hits with no `query` field.
- [ ] `POST /v1/search` with `{ "filters": { "fake": "x" } }` returns 400 with `field "fake": unknown field`.
- [ ] `GET /v1/search` (no `keywords`) returns 200 with hits (regression test for #288 — the old behaviour was 400).
- [ ] `GET /v1/search` response includes `Deprecation: true` header.
- [ ] CASL access-control filter still appended (integration test against a multi-tenant fixture if available; manual check otherwise).
- [ ] Audit log row includes `details.filters` and `details.appliedFilter`.

### 6.3 P2
- [ ] Migration `0035_*.sql` applied; `\d archived_emails` in psql shows `sent_at` is nullable and `original_date_source`, `date_backfilled_at` columns exist.
- [ ] New email ingested via IMAP — confirm `sentAt` matches the original `Date` header (compare against raw `.eml`).
- [ ] New email ingested with `Date:` header stripped — confirm `sentAt` falls through to `Received:` chain or to null.
- [ ] Frontend detail view for a null-`sentAt` email shows "Original date unknown" and "Archived on: <timestamp>".
- [ ] Backfill CLI: `node packages/backend/dist/scripts/run-date-backfill.js` enqueues a planner job; queue dashboard (BullMQ) shows progress.
- [ ] After backfill completes for a known-bad bulk-import source, sample five emails — confirm dates now match the original headers in their .eml.

### 6.4 P3
- [ ] Backend boots; Meilisearch `getSettings` for `emails` index shows `path`, `tags`, `hasAttachments`, `sizeBytes`, `isOnLegalHold`, `threadId`, `attachments.sha256`, `subject` in `filterableAttributes`; `subject`, `from`, `sizeBytes` in `sortableAttributes`.
- [ ] `POST /v1/admin/reindex { "scope": "full" }` returns a `jobId`; `GET /v1/admin/reindex/:jobId` reports progress.
- [ ] After reindex, `POST /v1/search { "filters": { "hasAttachments": true } }` returns the expected subset.
- [ ] `POST /v1/search { "filters": { "attachments.sha256": "<hex>" } }` matches emails that contain that attachment.

### 6.5 P4 / P5 / P6
- [ ] Open `/dashboard/search`; advanced filter panel toggles open.
- [ ] Apply a date range + From filter; URL contains both as flat query params.
- [ ] Reload the page; filters round-trip from URL.
- [ ] Clear all → URL empties; results refresh.
- [ ] Set matching strategy to "Verbatim", click "Set as default", reload — strategy persists.
- [ ] Sort dropdown "Largest first" → results reorder, URL contains `sort=sizeBytes:desc`.
- [ ] Mobile viewport: filter trigger opens a side-sheet, not an inline collapsible.

---

## 7. Open questions for maintainers

These don't block planning but need answers before the PRs in their column land. List, not blockers.

| # | Question | Blocks |
|--:|----------|--------|
| Q1 | Default `limit` for `POST /v1/search`: 25 (per spec) or 10 (current GET default)? | P1 |
| Q2 | Should empty body (no query, no filters) return all results capped by `limit`, or 400? Plan recommends "return all" — confirm. | P1 |
| Q3 | Should the `search:filter` permission be a separate CASL ability from `search:archive`? Plan recommends no. | P1 |
| Q4 | Backfill auto-run on upgrade vs. manual trigger? Plan recommends manual via CLI/admin endpoint. | P2 |
| Q5 | Add `index('sent_at_idx')` for date-range filters at the DB layer? Out of scope for P2; track follow-up. | P2 |
| Q6 | Should `userPreferences` graduate to a DB table now or wait? Plan recommends localStorage v1 with documented migration path. | P6 |
| Q7 | Frontend test stack: vitest + playwright? Plan assumes yes. | P0, P4 |
| Q8 | Tags endpoint (`GET /v1/tags`) or rely on facet distribution for autocomplete? Plan ships free-text in v1. | P4 (follow-up) |
| Q9 | Mailbox endpoint (`GET /v1/archive/mailboxes`) — who builds it? Plan flags as a small backend issue. | P4 (MailboxFilter) |
| Q10 | OpenAPI spec regeneration cadence — manual `pnpm openapi:gen` per PR or pre-commit? | P1, P3 |

---

## 8. What this plan does NOT do

For absolute clarity:

- It does not start coding. Each sub-plan is the implementation reference; this document is the integration layer.
- It does not modify the umbrella issue (#381) — the issue is the public surface, this doc is the engineering surface.
- It does not commit to dates. Sequencing is logical, not calendar.
- It does not bundle PRs. Each row in §3 is a separate review unit so reverts stay surgical.
- It does not address #367 (semantic search) — separate initiative.

---

## 9. Sub-plan references

The four sub-plan documents that this master plan integrates live as agent transcripts. For posterity, the key file-paths each sub-plan calls out:

**P1 (search API plumbing):**
- `packages/backend/src/api/controllers/search.controller.ts`
- `packages/backend/src/services/SearchService.ts`
- `packages/backend/src/services/search/filterTranslator.ts` (new)
- `packages/types/src/search.types.ts`
- `packages/backend/src/api/routes/search.routes.ts`

**P2 (date integrity):**
- `packages/backend/src/helpers/dateExtractor.ts` (new)
- `packages/backend/src/database/schema/archived-emails.ts`
- `packages/backend/src/services/IngestionService.ts` (lines 656, 694)
- `packages/backend/src/services/IndexingService.ts` (lines 333, 375, 420, 544)
- `packages/backend/src/jobs/processors/date-backfill.processor.ts` (new)
- All six connectors under `packages/backend/src/services/ingestion-connectors/`

**P3 (index expansion):**
- `packages/types/src/email.types.ts`
- `packages/backend/src/services/SearchService.ts` (lines 162-187)
- `packages/backend/src/services/IndexingService.ts` (lines 380-423, 459-480)
- `packages/backend/src/jobs/queues.ts`
- `packages/backend/src/api/server.ts`
- New: `packages/backend/src/services/ReindexService.ts`, `packages/backend/src/jobs/processors/reindex-emails.processor.ts`, `packages/backend/src/api/controllers/reindex.controller.ts`, `packages/backend/src/api/routes/reindex.routes.ts`

**P4/P5/P6 (frontend):**
- `packages/frontend/src/routes/dashboard/search/+page.svelte`
- `packages/frontend/src/routes/dashboard/search/+page.server.ts`
- `packages/frontend/src/lib/server/api.ts`
- `packages/types/src/search.types.ts`
- `packages/frontend/src/lib/translations/en.json`
- Ten new UI primitives under `packages/frontend/src/lib/components/ui/`
- Component tree under `packages/frontend/src/routes/dashboard/search/components/`
