# Legal Holds: User Interface Guide

The legal holds management interface is located at **Dashboard → Compliance → Legal Holds**. It provides a complete view of all configured holds and tools for creating, applying, releasing, and deactivating them. Per-email hold controls are also available on each archived email's detail page.

## Overview

Legal holds suspend all automated and manual deletion for specific emails, regardless of any retention labels or policies that might otherwise govern them. They are the highest-priority mechanism in the data lifecycle and are intended for use by compliance officers and legal counsel responding to litigation, investigations, or audit requests.

## Holds Table

The main page displays a table of all legal holds with the following columns:

- **Name:** The hold name and its UUID displayed underneath for reference.
- **Reason:** A short excerpt of the hold's reason/description. Shows _"No reason provided"_ if omitted.
- **Emails:** A badge showing how many archived emails are currently linked to this hold.
- **Status:** A badge indicating whether the hold is:
  - **Active** (red badge): The hold is currently granting deletion immunity to linked emails.
  - **Inactive** (gray badge): The hold is deactivated; linked emails are no longer immune.
- **Created At:** The date the hold was created, in local date format.
- **Actions:** Dropdown menu with options depending on the hold's state (see below).

The table is sorted by creation date in ascending order.

## Creating a Hold

Click the **"Create New"** button above the table to open the creation dialog. New holds are always created in the **Active** state.

### Form Fields

- **Name** (Required): A unique, descriptive name. Maximum 255 characters.  
  Examples: `"Project Titan Litigation — 2026"`, `"SEC Investigation Q3 2025"`
- **Reason** (Optional): A free-text description of the legal basis for the hold. Maximum 2 000 characters. This appears in the audit log and is visible to other compliance officers.

### After Creation

The hold immediately becomes active. No emails are linked to it yet — use Bulk Apply or the individual email detail page to add emails.

## Editing a Hold

Click **Edit** from the actions dropdown to modify the hold's name or reason. The `isActive` state is changed separately via the **Activate / Deactivate** action.

## Activating and Deactivating a Hold

The **Deactivate** / **Activate** option appears inline in the actions dropdown. Changing the active state does not remove any email links — it only determines whether those links grant deletion immunity.

> **Important:** Deactivating a hold means that all emails linked *solely* to this hold lose their deletion immunity immediately. If any such emails have an expired retention period, they will be permanently deleted on the very next lifecycle worker cycle.

## Deleting a Hold

A hold **cannot be deleted while it is active**. Attempting to delete an active hold returns a `409 Conflict` error with the message: _"Cannot delete an active legal hold. Deactivate it first..."_

To delete a hold:
1. **Deactivate** it first using the Activate/Deactivate action.
2. Click **Delete** from the actions dropdown.
3. Confirm in the dialog.

Deletion permanently removes the hold record and, via database CASCADE, all `email_legal_holds` link rows. The emails themselves are not deleted — they simply lose the protection that this hold was providing. Any other active holds on those emails continue to protect them.

## Bulk Apply

The **Bulk Apply** option (available only on active holds) opens a search dialog that lets you cast a preservation net across potentially thousands of emails in a single operation.

### Search Fields

- **Full-text query:** Keywords to match against email subject, body, and attachment content. This uses Meilisearch's full-text engine with typo tolerance.
- **From (sender):** Filter by sender email address.
- **Start date / End date:** Filter by the date range of the email's `sentAt` field.

At least one of these fields must be filled before the **Apply Hold** button becomes enabled.

### What Happens During Bulk Apply

1. The system pages through all Meilisearch results matching the query (1 000 hits per page).
2. Each hit's email ID is validated against the database to discard any stale index entries.
3. New hold links are inserted in batches of 500. Emails already linked to this hold are skipped (idempotent).
4. A success notification shows **how many emails were newly placed under the hold** (already-protected emails are not counted again).
5. The exact search query JSON is written to the audit log as GoBD proof of the scope of protection.

> **Warning:** Bulk Apply is a wide-net operation. Review your query carefully — there is no per-email confirmation step. Use the search page first to preview results before applying.

### Bulk Apply and the Audit Log

The audit log entry for a bulk apply contains:
- `action: "BulkApplyHold"`
- `searchQuery`: the exact JSON query used
- `emailsLinked`: number of emails newly linked
- `emailsAlreadyProtected`: number of emails that were already under this hold

## Release All Emails

The **Release All** option (available when the hold has at least one linked email) removes every `email_legal_holds` link for this hold in a single operation.

> **Warning:** This immediately lifts deletion immunity for all emails that were solely protected by this hold. Emails with expired retention periods will be deleted on the next lifecycle worker cycle.

A confirmation dialog is shown before the operation proceeds. On success, a notification reports how many email links were removed.

## Per-Email Hold Controls

### Viewing Holds on a Specific Email

On any archived email's detail page, the **Legal Holds** card lists all holds currently applied to that email, showing:
- Hold name and active/inactive badge
- Date the hold was applied

### Applying a Hold to a Specific Email

In the Legal Holds card, a dropdown lists all currently **active** holds. Select a hold and click **Apply**. The operation is idempotent — applying the same hold twice has no effect.

### Removing a Hold from a Specific Email

Each linked hold in the card has a **Remove** button. Clicking it removes only the link between this email and that specific hold. The hold itself remains and continues to protect other emails.

> **Note:** Removing the last active hold from an email means the email is no longer immune. If its retention period has expired, it will be deleted on the next lifecycle worker cycle.

### Delete Button Behaviour Under a Hold

The **Delete Email** button on the email detail page is not disabled in the UI, but the backend will reject the request if the email is under an active hold. An error toast is displayed: _"Deletion blocked by retention policy (Legal Hold or similar)."_

## Permissions Reference

| Operation                        | Required Permission |
| -------------------------------- | ------------------- |
| View holds table                 | `manage:all`        |
| Create / edit / delete a hold    | `manage:all`        |
| Activate / deactivate a hold     | `manage:all`        |
| Bulk apply                       | `manage:all`        |
| Release all emails from a hold   | `manage:all`        |
| View holds on a specific email   | `read:archive`      |
| Apply / remove a hold from email | `manage:all`        |

## Workflow: Responding to a Litigation Notice

1. **Receive the litigation notice.** Identify the relevant custodians, date range, and keywords.
2. **Create a hold**: Navigate to Dashboard → Compliance → Legal Holds and click **Create New**. Name it descriptively (e.g., `"Doe v. Acme Corp — 2026"`). Add the legal matter reference as the reason.
3. **Bulk apply**: Click **Bulk Apply** on the new hold. Enter keywords, the custodian's email address in the **From** field, and the relevant date range. Submit.
4. **Verify**: Check the email count badge on the hold row. Review the audit log to confirm the search query was recorded.
5. **Individual additions**: If specific emails not captured by the bulk query need to be preserved, open each email's detail page and apply the hold manually.
6. **When the matter concludes**: Click **Deactivate** on the hold, then **Release All** to remove all email links, and finally **Delete** the hold record if desired.

## Troubleshooting

### Cannot Delete Hold — "Cannot delete an active legal hold"
**Cause:** The hold is still active.  
**Solution:** Use the **Deactivate** option from the actions dropdown first.

### Bulk Apply Returns 0 Emails
**Cause 1:** The search query matched no documents in the Meilisearch index.  
**Solution:** Verify the query in the main Search page to preview results before applying.  
**Cause 2:** All Meilisearch results were stale (emails deleted from the archive before this operation).  
**Solution:** This is a data state issue; the stale index entries will be cleaned up on the next index rebuild.

### Delete Email Returns an Error Instead of Deleting
**Cause:** The email is under one or more active legal holds.  
**Solution:** This is expected behavior. Deactivate or remove the hold(s) from this email before deleting.

### Hold Emails Count Shows 0 After Bulk Apply
**Cause:** The `emailCount` field is fetched when the page loads. If the bulk operation was just completed, refresh the page to see the updated count.
