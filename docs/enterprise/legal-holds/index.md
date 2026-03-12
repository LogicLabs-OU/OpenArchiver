# Legal Holds

The Legal Holds feature is an enterprise-grade eDiscovery and compliance mechanism designed to prevent the spoliation (destruction) of evidence. It provides **absolute, unconditional immunity** from deletion for archived emails that are relevant to pending litigation, regulatory investigations, or audits.

## Core Principles

### 1. Absolute Immunity — Highest Precedence in the Lifecycle Pipeline

A legal hold is the final word on whether an email can be deleted. The [Lifecycle Worker](../retention-policy/lifecycle-worker.md) evaluates emails in a strict three-step precedence pipeline:

1. **Step 0 — Legal Hold** ← this feature
2. Step 1 — Retention Label
3. Step 2 — Retention Policy

If an email is linked to **at least one active** legal hold, the lifecycle worker immediately flags it as immune and stops evaluation. No retention label or policy can override this decision. The `RetentionHook` mechanism also blocks any **manual deletion** attempt from the UI — the backend will return an error before any `DELETE` SQL is issued.

### 2. Many-to-Many Relationship

A single email can be placed under multiple holds simultaneously (e.g., one hold for a litigation case and another for a regulatory investigation). The email remains immune as long as **any one** of those holds is active. Each hold-to-email link is recorded independently with its own `appliedAt` timestamp and actor attribution.

### 3. Active/Inactive State Management

Every hold has an `isActive` flag. When a legal matter concludes, the responsible officer deactivates the hold. The deactivation is instantaneous — on the very next lifecycle worker cycle, emails that were solely protected by that hold will be evaluated normally against retention labels and policies. If their retention period has already expired, they will be permanently deleted in that same cycle.

A hold **must be deactivated before it can be deleted**. This requirement forces an explicit, auditable act of lifting legal protection before the hold record can be removed from the system.

### 4. Bulk Preservation via Search Queries

The primary use case for legal holds is casting a wide preservation net quickly. The bulk-apply operation accepts a full Meilisearch query (full-text search + metadata filters such as sender, date range, etc.) and links every matching email to the hold in a single operation. The system pages through results in batches of 1 000 to handle datasets of any size without timing out the UI.

### 5. GoBD Audit Trail

Every action within the legal hold module — hold creation, modification, deactivation, deletion, email linkage, email removal, and bulk operations — is immutably recorded in the cryptographically chained `audit_logs` table. For bulk operations, the exact `SearchQuery` JSON used to cast the hold net is persisted in the audit log as proof of scope, satisfying GoBD and similar evidence-preservation requirements.

## Feature Requirements

The Legal Holds feature requires:

- An active **Enterprise license** with the `LEGAL_HOLDS` feature enabled.
- The `manage:all` permission for all hold management and bulk operations.
- The `read:archive` permission for viewing holds applied to a specific email.
- The `manage:all` permission for applying or removing a hold from an individual email.

## Use Cases

### Active Litigation Hold

Upon receiving a litigation notice, a compliance officer creates a hold named "Project Titan Litigation — 2026", applies it via a bulk query scoped to a specific custodian's emails and a date range, and immediately freezes those records. The audit log provides timestamped proof that the hold was in place from the moment of creation.

### Regulatory Investigation

A regulator requests preservation of all finance-related communications from a specific period. The officer creates a hold and uses a keyword + date-range bulk query to capture every relevant email in seconds, regardless of which users sent or received them.

### Tax Audit

Before an annual audit window, an officer applies a hold to all emails matching tax-relevant keywords. The hold is released once the audit concludes, and standard retention policies resume.

### eDiscovery Case Management

Holds can optionally be linked to an `ediscovery_cases` record (`caseId` field) to organise multiple holds under a single legal matter. This allows all holds, emails, and audit events for a case to be referenced together.

## Architecture Overview

| Component       | Location                                                                       | Description                                                    |
| --------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Types           | `packages/types/src/retention.types.ts`                                        | `LegalHold`, `EmailLegalHoldInfo`, `BulkApplyHoldResult` types |
| Database Schema | `packages/backend/src/database/schema/compliance.ts`                           | `legal_holds` and `email_legal_holds` table definitions        |
| Service         | `packages/enterprise/src/modules/legal-holds/LegalHoldService.ts`             | All business logic for CRUD, linkage, and bulk operations      |
| Controller      | `packages/enterprise/src/modules/legal-holds/legal-hold.controller.ts`        | Express request handlers with Zod validation                   |
| Routes          | `packages/enterprise/src/modules/legal-holds/legal-hold.routes.ts`            | Route registration with auth and feature guards                |
| Module          | `packages/enterprise/src/modules/legal-holds/legal-hold.module.ts`            | App-startup integration and `RetentionHook` registration       |
| Frontend Page   | `packages/frontend/src/routes/dashboard/compliance/legal-holds/`              | SvelteKit management page for holds                            |
| Email Detail    | `packages/frontend/src/routes/dashboard/archived-emails/[id]/`                | Per-email hold card in the email detail view                   |
| Lifecycle Guard | `packages/backend/src/hooks/RetentionHook.ts`                                  | Static hook that blocks deletion if a hold is active           |

## Data Model

### `legal_holds` Table

| Column       | Type           | Description                                                                 |
| ------------ | -------------- | --------------------------------------------------------------------------- |
| `id`         | `uuid` (PK)    | Auto-generated unique identifier.                                           |
| `name`       | `varchar(255)` | Human-readable hold name.                                                   |
| `reason`     | `text`         | Optional description of why the hold was placed.                            |
| `is_active`  | `boolean`      | Whether the hold currently grants immunity. Defaults to `true` on creation. |
| `case_id`    | `uuid` (FK)    | Optional reference to an `ediscovery_cases` row.                            |
| `created_at` | `timestamptz`  | Hold creation timestamp.                                                    |
| `updated_at` | `timestamptz`  | Last modification timestamp.                                                |

### `email_legal_holds` Join Table

| Column                | Type          | Description                                                     |
| --------------------- | ------------- | --------------------------------------------------------------- |
| `email_id`            | `uuid` (FK)   | Reference to `archived_emails.id`. Cascades on delete.          |
| `legal_hold_id`       | `uuid` (FK)   | Reference to `legal_holds.id`. Cascades on delete.              |
| `applied_at`          | `timestamptz` | DB-server timestamp of when the link was created.               |
| `applied_by_user_id`  | `uuid` (FK)   | User who applied the hold (nullable for system operations).     |

The table uses a composite primary key of `(email_id, legal_hold_id)`, enforcing uniqueness at the database level. Duplicate inserts use `ON CONFLICT DO NOTHING` for idempotency.

## Integration Points

### RetentionHook (Deletion Guard)

`LegalHoldModule.initialize()` registers an async check with `RetentionHook` at application startup. `ArchivedEmailService.deleteArchivedEmail()` calls `RetentionHook.canDelete(emailId)` before any storage or database DELETE. If the email is under an active hold, the hook returns `false` and deletion is aborted with a `400 Bad Request` error. This guard is fail-safe: if the hook itself throws an error, deletion is also blocked.

### Lifecycle Worker

The lifecycle worker calls `legalHoldService.isEmailUnderActiveHold(emailId)` as the first step in its per-email evaluation loop. Immune emails are skipped immediately with a `debug`-level log entry; no further evaluation occurs.

### Audit Log

All legal hold operations generate entries in `audit_logs`:

| Action                           | `actionType` | `targetType`    | `targetId`        |
| -------------------------------- | ------------ | --------------- | ----------------- |
| Hold created                     | `CREATE`     | `LegalHold`     | hold ID           |
| Hold updated / deactivated       | `UPDATE`     | `LegalHold`     | hold ID           |
| Hold deleted                     | `DELETE`     | `LegalHold`     | hold ID           |
| Email linked to hold (individual)| `UPDATE`     | `ArchivedEmail` | email ID          |
| Email unlinked from hold         | `UPDATE`     | `ArchivedEmail` | email ID          |
| Bulk apply via search            | `UPDATE`     | `LegalHold`     | hold ID + query JSON |
| All emails released from hold    | `UPDATE`     | `LegalHold`     | hold ID           |

Individual email link/unlink events target `ArchivedEmail` so that a per-email audit search surfaces the complete hold history for that email.
