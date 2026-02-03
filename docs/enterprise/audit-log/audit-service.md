# Audit Log: Backend Implementation

The backend implementation of the audit log is handled by the `AuditService`, located in `packages/backend/src/services/AuditService.ts`. This service encapsulates all the logic for creating, retrieving, and verifying audit log entries.

## Hashing and Verification Logic

The core of the audit log's immutability lies in its hashing and verification logic.

### Hash Calculation

The `calculateHash` method is responsible for generating a SHA-256 hash of a log entry. To ensure consistency, it performs the following steps:

1.  **Canonical Object Creation:** It constructs a new object with a fixed property order, ensuring that the object's structure is always the same.
2.  **Timestamp Normalization:** It converts the `timestamp` to milliseconds since the epoch (`getTime()`) to avoid any precision-related discrepancies between the application and the database.
3.  **Canonical Stringification:** It uses a custom `canonicalStringify` function to create a JSON string representation of the object. This function sorts the object keys, ensuring that the output is always the same, regardless of the in-memory property order.
4.  **Hash Generation:** It computes a SHA-256 hash of the canonical string.

### Verification Process

The `verifyAuditLog` method is designed to be highly scalable and efficient, even with millions of log entries. It processes the logs in manageable chunks (e.g., 1000 at a time) to avoid loading the entire table into memory.

The verification process involves the following steps:

1.  **Iterative Processing:** It fetches the logs in batches within a `while` loop.
2.  **Chain Verification:** For each log entry, it compares the `previousHash` with the `currentHash` of the preceding log. If they do not match, the chain is broken, and the verification fails.
3.  **Hash Recalculation:** It recalculates the hash of the current log entry using the same `calculateHash` method used during creation.
4.  **Integrity Check:** It compares the recalculated hash with the `currentHash` stored in the database. If they do not match, the log entry has been tampered with, and the verification fails.

## Service Integration

The `AuditService` is integrated into the application through the `AuditLogModule` (`packages/enterprise/src/modules/audit-log/audit-log.module.ts`), which registers the API routes for the audit log feature. The service's `createAuditLog` method is called from various other services throughout the application to record significant events.
