# Retention Policy: User Interface

The retention policy management interface is located at **Dashboard → Compliance → Retention Policies**. It provides a comprehensive view of all configured policies and tools for creating, editing, deleting, and simulating retention rules.

## Policy Table

The main page displays a table of all retention policies with the following columns:

- **Name:** The policy name and its UUID displayed underneath for reference.
- **Priority:** The numeric priority value. Lower values indicate higher priority.
- **Retention Period:** The number of days emails matching this policy are retained before expiry.
- **Ingestion Scope:** Shows which ingestion sources the policy is restricted to. Displays "All ingestion sources" when the policy has no scope restriction, or individual source name badges when scoped.
- **Conditions:** A summary of the rule group. Displays "No conditions (matches all emails)" for policies without conditions, or "N rule(s) (AND/OR)" for policies with conditions.
- **Status:** A badge indicating whether the policy is Active or Inactive.
- **Actions:** Edit and Delete buttons for each policy.

The table is sorted by policy priority by default.

## Creating a Policy

Click the **"Create Policy"** button above the table to open the creation dialog. The form contains the following sections:

### Basic Information

- **Policy Name:** A unique, descriptive name for the policy.
- **Description:** An optional detailed description of the policy's purpose.
- **Priority:** A positive integer determining evaluation order (lower = higher priority).
- **Retention Period (Days):** The number of days to retain matching emails.

### Ingestion Scope

This section controls which ingestion sources the policy applies to:

- **"All ingestion sources" toggle:** When enabled, the policy applies to emails from all ingestion sources. This is the default.
- **Per-source checkboxes:** When the "all" toggle is disabled, individual ingestion sources can be selected. Each source displays its name and provider type as a badge.

### Condition Rules

Conditions define which emails the policy targets. If no conditions are added, the policy matches all emails (within its ingestion scope).

- **Logical Operator:** Choose **AND** (all rules must match) or **OR** (any rule must match).
- **Add Rule:** Each rule consists of:
    - **Field:** The email metadata field to evaluate (`sender`, `recipient`, `subject`, or `attachment_type`).
    - **Operator:** The comparison operator (see [Supported Operators](#supported-operators) below).
    - **Value:** The string value to compare against.
- **Remove Rule:** Each rule has a remove button to delete it from the group.

### Supported Operators

| Operator       | Display Name | Description                                                      |
| -------------- | ------------ | ---------------------------------------------------------------- |
| `equals`       | Equals       | Exact case-insensitive match.                                    |
| `not_equals`   | Not Equals   | Inverse of equals.                                               |
| `contains`     | Contains     | Case-insensitive substring match.                                |
| `not_contains` | Not Contains | Inverse of contains.                                             |
| `starts_with`  | Starts With  | Case-insensitive prefix match.                                   |
| `ends_with`    | Ends With    | Case-insensitive suffix match.                                   |
| `domain_match` | Domain Match | Matches when an email address ends with `@<value>`.              |
| `regex_match`  | Regex Match  | ECMAScript regular expression (case-insensitive, max 200 chars). |

### Policy Status

- **Enable Policy toggle:** Controls whether the policy is active immediately upon creation.

## Editing a Policy

Click the **Edit** button (pencil icon) on any policy row to open the edit dialog. The form is pre-populated with the policy's current values. All fields can be modified, and the same validation rules apply as during creation.

## Deleting a Policy

Click the **Delete** button (trash icon) on any policy row. A confirmation dialog appears to prevent accidental deletion. Deleting a policy is irreversible. Once deleted, the policy no longer affects the lifecycle worker's evaluation of emails.

## Policy Simulator

The **"Simulate Policy"** button opens a simulation tool that evaluates hypothetical email metadata against all active policies without making any changes.

### Simulator Input Fields

- **Sender Email:** The sender address to evaluate (e.g., `cfo@finance.acme.com`).
- **Recipients:** A comma-separated list of recipient email addresses.
- **Subject:** The email subject line.
- **Attachment Types:** A comma-separated list of file extensions (e.g., `.pdf, .xlsx`).
- **Ingestion Source:** An optional dropdown to select a specific ingestion source for scope-aware evaluation. Defaults to "All sources".

### Simulator Results

After submission, the simulator displays:

- **Applied Retention Period:** The longest retention period from all matching policies, displayed in days.
- **Action on Expiry:** The action that would be taken when the retention period expires (currently always "Permanent Deletion").
- **Matching Policies:** A list of all policy IDs (with their names) that matched the provided metadata. If no policies match, a message indicates that no matching policies were found.

The simulator is a safe, read-only tool intended for testing and verifying policy configurations before they affect live data.
