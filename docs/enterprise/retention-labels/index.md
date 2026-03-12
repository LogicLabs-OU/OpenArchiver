# Retention Labels

The Retention Labels feature is an enterprise-grade capability that provides item-level retention overrides for archived emails. Unlike retention policies which apply rules to groups of emails, retention labels are manually or programmatically applied to individual emails to override the normal retention lifecycle with specific retention periods.

## Core Principles

### 1. Item-Level Retention Override

Retention labels represent a specific, targeted retention requirement that takes precedence over any automated retention policies. When an email has a retention label applied, the label's `retentionPeriodDays` becomes the governing retention period for that email, regardless of what any retention policy would otherwise specify.

### 2. One Label Per Email

Each archived email can have at most one retention label applied at any time. Applying a new label to an email automatically removes any existing label, ensuring a clean, unambiguous retention state.

### 3. Deletion Behavior

Retention labels implement the following deletion logic:

- **Hard Delete**: If a label has never been applied to any emails, it can be completely removed from the system.
- **Soft Disable**: If a label is currently applied to one or more emails, deletion attempts result in the label being marked as `isDisabled = true`. This keeps the label-email relations but the retention label won't take effective.
- **Delete Disabled Labels**: If a label is currently applied to one or more emails, and it is disabled, a deletion request will delete the label itself and all label-email relations (remove the label from emails it is tagged with).

### 4. Immutable Retention Period

Once a retention label has been applied to any email, its `retentionPeriodDays` value becomes immutable to prevent tampering with active retention schedules. Labels can only have their retention period modified while they have zero applications.

### 5. User Attribution and Audit Trail

Every label application and removal is attributed to a specific user and recorded in the [Audit Log](../audit-log/index.md). This includes both manual UI actions and automated API operations, ensuring complete traceability of retention decisions.

### 6. Lifecycle Integration

The [Lifecycle Worker](../retention-policy/lifecycle-worker.md) gives retention labels the highest priority during email evaluation. If an email has a retention label applied, the label's retention period is used instead of any matching retention policy rules.

## Feature Requirements

The Retention Labels feature requires:

- An active **Enterprise license** with the `RETENTION_POLICY` feature enabled.
- The `manage:all` permission for administrative operations (creating, editing, deleting labels).
- The `delete:archive` permission for applying and removing labels from individual emails.

## Use Cases

### Legal Hold Alternative

Retention labels can serve as a lightweight alternative to formal legal holds by applying extended retention periods (e.g., 10+ years) to specific emails related to litigation or investigation.

### Executive Communications

Apply extended retention to emails from or to executive leadership to ensure important business communications are preserved beyond normal retention periods.

### Regulatory Exceptions

Mark specific emails that must be retained for regulatory compliance (e.g., financial records, safety incidents) with appropriate retention periods regardless of general policy rules.

### Project-Specific Retention

Apply custom retention periods to emails related to specific projects, contracts, or business initiatives that have unique preservation requirements.

## Architecture Overview

The feature is composed of the following components:

| Component            | Location                                                              | Description                                                  |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Types                | `packages/types/src/retention.types.ts`                               | Shared TypeScript types for labels and email label info.     |
| Database Schema      | `packages/backend/src/database/schema/compliance.ts`                  | Drizzle ORM table definitions for retention labels.          |
| Label Service        | `packages/enterprise/src/modules/retention-policy/RetentionLabelService.ts` | CRUD operations and label application logic.        |
| API Controller       | `packages/enterprise/src/modules/retention-policy/retention-label.controller.ts` | Express request handlers with Zod validation.   |
| API Routes           | `packages/enterprise/src/modules/retention-policy/retention-policy.routes.ts` | Route registration with auth and feature guards.    |
| Frontend Page        | `packages/frontend/src/routes/dashboard/compliance/retention-labels/` | SvelteKit page for label management.                        |
| Email Integration    | Individual archived email pages                                       | Label application UI in email detail views.                 |

## Data Model

### Retention Labels Table

| Column               | Type          | Description                                                     |
| -------------------- | ------------- | --------------------------------------------------------------- |
| `id`                 | `uuid` (PK)   | Auto-generated unique identifier.                               |
| `name`               | `varchar(255)` | Human-readable label name (unique constraint).                 |
| `retention_period_days` | `integer`   | Number of days to retain emails with this label.               |
| `description`        | `text`        | Optional description of the label's purpose.                   |
| `is_disabled`        | `boolean`     | Whether the label is disabled (cannot be applied to new emails). |
| `created_at`         | `timestamptz` | Creation timestamp.                                             |

### Email Label Applications Table

| Column               | Type          | Description                                                     |
| -------------------- | ------------- | --------------------------------------------------------------- |
| `email_id`           | `uuid` (FK)   | Reference to the archived email.                               |
| `label_id`           | `uuid` (FK)   | Reference to the retention label.                               |
| `applied_at`         | `timestamptz` | Timestamp when the label was applied.                          |
| `applied_by_user_id` | `uuid` (FK)   | User who applied the label (nullable for API key operations).  |

The table uses a composite primary key of `(email_id, label_id)` to enforce the one-label-per-email constraint at the database level.

## Integration Points

### Lifecycle Worker

The lifecycle worker queries the `email_retention_labels` table during email evaluation. If an email has a retention label applied, the label's `retentionPeriodDays` takes precedence over any retention policy evaluation.

### Audit Log

All retention label operations generate audit log entries:

- **Label Creation**: Action type `CREATE`, target type `RetentionLabel`
- **Label Updates**: Action type `UPDATE`, target type `RetentionLabel`  
- **Label Deletion/Disabling**: Action type `DELETE` or `UPDATE`, target type `RetentionLabel`
- **Label Application**: Action type `UPDATE`, target type `ArchivedEmail`, details include label information
- **Label Removal**: Action type `UPDATE`, target type `ArchivedEmail`, details include removed label information

### Email Detail Pages

Individual archived email pages display any applied retention label and provide controls for users with appropriate permissions to apply or remove labels.