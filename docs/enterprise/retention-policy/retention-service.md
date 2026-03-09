# Retention Policy: Backend Implementation

The backend implementation of the retention policy engine is handled by the `RetentionService`, located in `packages/enterprise/src/modules/retention-policy/RetentionService.ts`. This service encapsulates all CRUD operations for policies and the core evaluation engine that determines which policies apply to a given email.

## Database Schema

The `retention_policies` table is defined in `packages/backend/src/database/schema/compliance.ts` using Drizzle ORM:

| Column                | Type                       | Description                                                                 |
| --------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `id`                  | `uuid` (PK)               | Auto-generated unique identifier.                                           |
| `name`                | `text` (unique, not null)  | Human-readable policy name.                                                 |
| `description`         | `text`                     | Optional description.                                                       |
| `priority`            | `integer` (not null)       | Priority for ordering. Lower = higher priority.                             |
| `retention_period_days` | `integer` (not null)     | Number of days to retain matching emails.                                   |
| `action_on_expiry`    | `enum` (not null)          | Action on expiry (`delete_permanently`).                                    |
| `is_enabled`          | `boolean` (default: true)  | Whether the policy is active.                                               |
| `conditions`          | `jsonb`                    | Serialized `RetentionRuleGroup` or null (null = matches all).               |
| `ingestion_scope`     | `jsonb`                    | Array of ingestion source UUIDs or null (null = all sources).               |
| `created_at`          | `timestamptz`              | Creation timestamp.                                                         |
| `updated_at`          | `timestamptz`              | Last update timestamp.                                                      |

## CRUD Operations

The `RetentionService` class provides the following methods:

### `createPolicy(data, actorId, actorIp)`

Inserts a new policy into the database and creates an audit log entry with action type `CREATE` and target type `RetentionPolicy`. The audit log details include the policy name, retention period, priority, action on expiry, and ingestion scope.

### `getPolicies()`

Returns all policies ordered by priority ascending. The raw database rows are mapped through `mapDbPolicyToType()`, which converts the DB column `isEnabled` to the shared type field `isActive` and normalizes date fields to ISO strings.

### `getPolicyById(id)`

Returns a single policy by UUID, or null if not found.

### `updatePolicy(id, data, actorId, actorIp)`

Partially updates a policy — only fields present in the DTO are modified. The `updatedAt` timestamp is always set to the current time. An audit log entry is created with action type `UPDATE`, recording which fields were changed.

Throws an error if the policy is not found.

### `deletePolicy(id, actorId, actorIp)`

Deletes a policy by UUID and creates an audit log entry with action type `DELETE`, recording the deleted policy's name. Returns `false` if the policy was not found.

## Evaluation Engine

The evaluation engine is the core logic that determines which policies apply to a given email. It is used by both the lifecycle worker (for automated enforcement) and the policy simulator endpoint (for testing).

### `evaluateEmail(metadata)`

This is the primary evaluation method. It accepts email metadata and returns:
- `appliedRetentionDays`: The longest matching retention period (max-duration-wins).
- `matchingPolicyIds`: UUIDs of all policies that matched.
- `actionOnExpiry`: Always `"delete_permanently"` in the current implementation.

The evaluation flow:

1. **Fetch active policies:** Queries all policies where `isEnabled = true`.
2. **Ingestion scope check:** For each policy with a non-null `ingestionScope`, the email's `ingestionSourceId` must be included in the scope array. If not, the policy is skipped.
3. **Condition evaluation:** If the policy has no conditions (`null`), it matches all emails within scope. Otherwise, the condition rule group is evaluated.
4. **Max-duration-wins:** If multiple policies match, the longest `retentionPeriodDays` is used.
5. **Zero means no match:** A return value of `appliedRetentionDays = 0` indicates no policy matched — the lifecycle worker will not delete the email.

### `_evaluateRuleGroup(group, metadata)`

Evaluates a `RetentionRuleGroup` using AND or OR logic:
- **AND:** Every rule in the group must pass.
- **OR:** At least one rule must pass.
- An empty rules array evaluates to `true`.

### `_evaluateRule(rule, metadata)`

Evaluates a single rule against the email metadata. All string comparisons are case-insensitive (both sides are lowercased before comparison). The behavior depends on the field:

| Field             | Behavior                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| `sender`          | Compares against the sender email address.                               |
| `recipient`       | Passes if **any** recipient matches the operator.                        |
| `subject`         | Compares against the email subject.                                      |
| `attachment_type` | Passes if **any** attachment file extension matches (e.g., `.pdf`).      |

### `_applyOperator(haystack, operator, needle)`

Applies a string-comparison operator between two pre-lowercased strings:

| Operator       | Implementation                                                                |
| -------------- | ----------------------------------------------------------------------------- |
| `equals`       | `haystack === needle`                                                         |
| `not_equals`   | `haystack !== needle`                                                         |
| `contains`     | `haystack.includes(needle)`                                                   |
| `not_contains` | `!haystack.includes(needle)`                                                  |
| `starts_with`  | `haystack.startsWith(needle)`                                                 |
| `ends_with`    | `haystack.endsWith(needle)`                                                   |
| `domain_match` | `haystack.endsWith('@' + needle)` (auto-prepends `@` if missing)             |
| `regex_match`  | `new RegExp(needle, 'i').test(haystack)` with safety guards (see below)       |

### Security: `regex_match` Safeguards

The `regex_match` operator includes protections against Regular Expression Denial of Service (ReDoS):

1. **Length limit:** Patterns exceeding 200 characters (`MAX_REGEX_LENGTH`) are rejected and treated as non-matching. A warning is logged.
2. **Error handling:** Invalid regex syntax is caught in a try/catch block and treated as non-matching. A warning is logged.
3. **Flags:** Only the case-insensitive flag (`i`) is used. Global and multiline flags are excluded to prevent stateful matching bugs.

## Request Validation

The `RetentionPolicyController` (`retention-policy.controller.ts`) validates all incoming requests using Zod schemas before passing data to the service:

| Constraint                  | Limit                                                          |
| --------------------------- | -------------------------------------------------------------- |
| Policy name                 | 1–255 characters.                                              |
| Description                 | Max 1000 characters.                                           |
| Priority                    | Positive integer (≥ 1).                                        |
| Retention period            | Positive integer (≥ 1 day).                                    |
| Rules per group             | Max 50.                                                        |
| Rule value                  | 1–500 characters.                                              |
| Ingestion scope entries     | Each must be a valid UUID. Empty arrays are coerced to `null`. |
| Evaluate — sender           | Max 500 characters.                                            |
| Evaluate — recipients       | Max 500 entries, each max 500 characters.                      |
| Evaluate — subject          | Max 2000 characters.                                           |
| Evaluate — attachment types | Max 100 entries, each max 50 characters.                       |

## Module Registration

The `RetentionPolicyModule` (`retention-policy.module.ts`) implements the `ArchiverModule` interface and registers the API routes at:

```
/{api.version}/enterprise/retention-policy
```

All routes are protected by:
1. `requireAuth` — Ensures the request includes a valid authentication token.
2. `featureEnabled(OpenArchiverFeature.RETENTION_POLICY)` — Ensures the enterprise license includes the retention policy feature.
3. `requirePermission('manage', 'all')` — Ensures the user has administrative permissions.
