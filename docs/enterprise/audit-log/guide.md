# Audit Log: User Interface

The audit log user interface provides a comprehensive view of all significant events that have occurred within the Open Archiver system. It is designed to be intuitive and user-friendly, allowing administrators to easily monitor and review system activity.

## Viewing Audit Logs

The main audit log page displays a table of log entries, with the following columns:

- **Timestamp:** The date and time of the event.
- **Actor:** The identifier of the user or system process that performed the action.
- **IP Address:** The IP address from which the action was initiated.
- **Action:** The type of action performed, displayed as a color-coded badge for easy identification.
- **Target Type:** The type of resource that was affected.
- **Target ID:** The unique identifier of the affected resource.
- **Details:** A truncated preview of the event's details. The full JSON object is displayed in a pop-up card on hover.

## Filtering and Sorting

The table can be sorted by timestamp by clicking the "Timestamp" header. This allows you to view the logs in either chronological or reverse chronological order.

## Pagination

Pagination controls are available below the table, allowing you to navigate through the entire history of audit log entries.

## Verifying Log Integrity

The "Verify Log Integrity" button allows you to initiate a verification process to check the integrity of the entire audit log chain. This process recalculates the hash of each log entry and compares it to the stored hash, ensuring that the cryptographic chain is unbroken and no entries have been tampered with.

### Verification Responses

- **Success:** A success notification is displayed, confirming that the audit log integrity has been verified successfully. This means that the log chain is complete and no entries have been tampered with.

- **Failure:** An error notification is displayed, indicating that the audit log chain is broken or an entry has been tampered with. The notification will include the ID of the log entry where the issue was detected. There are two types of failures:
    - **Audit log chain is broken:** This means that the `previousHash` of a log entry does not match the `currentHash` of the preceding entry. This indicates that one or more log entries may have been deleted or inserted into the chain.
    - **Audit log entry is tampered!:** This means that the recalculated hash of a log entry does not match its stored `currentHash`. This indicates that the data within the log entry has been altered.

## Viewing Log Details

You can view the full details of any log entry by clicking on its row in the table. This will open a dialog containing all the information associated with the log entry, including the previous and current hashes.
