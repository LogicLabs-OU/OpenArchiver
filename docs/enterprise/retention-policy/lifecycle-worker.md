# Retention Policy: Lifecycle Worker

The lifecycle worker is the automated enforcement component of the retention policy engine. It runs as a BullMQ background worker that periodically scans all archived emails, evaluates them against active retention policies, and permanently deletes emails that have exceeded their retention period.

## Location

`packages/enterprise/src/workers/lifecycle.worker.ts`

## How It Works

### Scheduling

The lifecycle worker is registered as a repeatable BullMQ cron job on the `compliance-lifecycle` queue. It is scheduled to run daily at **02:00 UTC** by default. The cron schedule is configured via:

```typescript
repeat: { pattern: '0 2 * * *' }  // daily at 02:00 UTC
```

The `scheduleLifecycleJob()` function is called once during enterprise application startup to register the repeatable job with BullMQ.

### Batch Processing

To avoid loading the entire `archived_emails` table into memory, the worker processes emails in configurable batches:

1. **Batch size** is controlled by the `RETENTION_BATCH_SIZE` environment variable.
2. Emails are ordered by `archivedAt` ascending.
3. The worker iterates through batches using offset-based pagination until an empty batch is returned, indicating all emails have been processed.

### Per-Email Processing Flow

For each email in a batch, the worker:

1. **Extracts metadata:** Builds a `PolicyEvaluationRequest` from the email's database record:
    - `sender`: The sender email address.
    - `recipients`: All To, CC, and BCC recipient addresses.
    - `subject`: The email subject line.
    - `attachmentTypes`: File extensions (e.g., `.pdf`) extracted from attachment filenames via a join query.
    - `ingestionSourceId`: The UUID of the ingestion source that archived this email.

2. **Evaluates policies:** Passes the metadata to `RetentionService.evaluateEmail()`, which returns:
    - `appliedRetentionDays`: The longest matching retention period (0 if no policy matches).
    - `matchingPolicyIds`: UUIDs of all matching policies.

3. **Checks for expiry:**
    - If `appliedRetentionDays === 0`, no policy matched — the email is **skipped** (not deleted).
    - Otherwise, the email's age is calculated from its `sentAt` date.
    - If the age in days exceeds `appliedRetentionDays`, the email has expired.

4. **Deletes expired emails:** Calls `ArchivedEmailService.deleteArchivedEmail()` with:
    - `systemDelete: true` — Bypasses the `ENABLE_DELETION` configuration guard so retention enforcement always works regardless of that global setting.
    - `governingRule` — A string listing the matching policy IDs for the audit log entry (e.g., `"Policy IDs: abc-123, def-456"`).

5. **Logs the deletion:** A structured log entry records the email ID and its age in days.

### Error Handling

If processing a specific email fails (e.g., due to a database error or storage issue), the error is logged and the worker continues to the next email in the batch. This ensures that a single problematic email does not block the processing of the remaining emails.

If the entire job fails, BullMQ records the failure and the job ID and error are logged. Failed jobs are retained (up to 50) for debugging.

## System Actor

Automated deletions are attributed to a synthetic system actor in the audit log:

| Field        | Value                                |
| ------------ | ------------------------------------ |
| ID           | `system:lifecycle-worker`            |
| Email        | `system@open-archiver.internal`      |
| Name         | System Lifecycle Worker              |
| Actor IP     | `system`                             |

This well-known identifier can be filtered in the [Audit Log](../audit-log/index.md) to view all retention-based deletions.

## Audit Trail

Every email deleted by the lifecycle worker produces an audit log entry with:

- **Action type:** `DELETE`
- **Target type:** `ArchivedEmail`
- **Target ID:** The UUID of the deleted email
- **Actor:** `system:lifecycle-worker`
- **Details:** Includes `reason: "RetentionExpiration"` and `governingRule` listing the matching policy IDs

This ensures that every automated deletion is fully traceable back to the specific policies that triggered it.

## Configuration

| Environment Variable      | Description                                          | Default |
| ------------------------- | ---------------------------------------------------- | ------- |
| `RETENTION_BATCH_SIZE`    | Number of emails to process per batch iteration.     | —       |

## BullMQ Worker Settings

| Setting              | Value                  | Description                                        |
| -------------------- | ---------------------- | -------------------------------------------------- |
| Queue name           | `compliance-lifecycle` | The BullMQ queue name.                             |
| Job ID               | `lifecycle-daily`      | Stable job ID for the repeatable cron job.         |
| `removeOnComplete`   | Keep last 10           | Completed jobs retained for monitoring.            |
| `removeOnFail`       | Keep last 50           | Failed jobs retained for debugging.                |

## Integration with Deletion Guard

The core `ArchivedEmailService.deleteArchivedEmail()` method includes a deletion guard controlled by the `ENABLE_DELETION` system setting. When called with `systemDelete: true`, the lifecycle worker bypasses this guard. This design ensures that:

- Manual user deletions can be disabled organization-wide via the system setting.
- Automated retention enforcement always operates regardless of that setting, because retention compliance is a legal obligation that cannot be paused by a UI toggle.
