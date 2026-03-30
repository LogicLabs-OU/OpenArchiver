# Merging Ingestion Sources

Merged ingestion groups let you combine multiple ingestion sources so that their emails appear unified in browsing, search, and thread views. This is useful when you want to pair a historical archive (for example, a PST or Mbox import) with a live connection, or when migrating between providers.

## Concepts

| Term             | Definition                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Root source**  | An ingestion source where no merge parent is set. Shown as the primary row in the Ingestions table. All emails in the group are physically owned by the root.       |
| **Child source** | An ingestion source merged into a root. Acts as a fetch assistant — it connects to the provider and retrieves emails, but all data is stored under the root source. |
| **Group**        | A root source and all its children. All emails from every member are stored under and owned by the root.                                                            |

The hierarchy is **flat** — only one level of nesting is supported. If you merge a source into a child, the system automatically redirects the relationship to the root.

## Root Ownership — How Storage and Data Work

This is the key design principle of merged sources:

> **Child sources are assistants. They fetch emails from their provider but never own any stored data. Every email ingested by a child is written to the root source's storage folder and assigned the root source's ID in the database.**

In practical terms:

- The storage path for every email belongs to the root: `openarchiver/{root-name}-{root-id}/emails/...`
- Every `archived_emails` database row created by a child ingestion will have `ingestionSourceId` set to the **root's ID**, not the child's.
- Attachments are also stored under the root's folder and scoped to the root's ID.
- The root's **Preserve Original File** (GoBD compliance) setting is inherited by all children in the group. A child's own `preserveOriginalFile` setting is ignored during ingestion — only the root's setting applies.

This means browsing the root source's emails will show all emails from the entire group, including those fetched by child sources, without any extra configuration.

## When to Use Merged Sources

- **Historical + live**: Import a PST archive and merge it into an active IMAP or Google Workspace connection so historical and current emails appear in one unified mailbox.
- **Provider migration**: Add a new Microsoft 365 connector and merge it with your existing Google Workspace connector during a cutover period.
- **Backfill**: Import an Mbox export and merge it with a live connection to cover a gap in the archive.

## How to Merge a New Source Into an Existing One

Merging can only be configured **at creation time**.

1. Navigate to the **Ingestions** page.
2. Click **Create New** to open the ingestion source form.
3. Fill in the provider details as usual.
4. Expand the **Advanced Options** section at the bottom of the form. This section is only visible when at least one ingestion source already exists.
5. Check **Merge into existing ingestion** and select the target root source from the dropdown.
6. Click **Submit**.

The new source will run its initial import normally. Once complete, its emails will appear alongside those of the root source — all stored under the root.

## How Emails Appear When Merged

When you browse archived emails for a root source, you see all emails in the group because they are all physically owned by the root. There is nothing to aggregate — the data is already unified at the storage and database level.

The same applies to search: filtering by a root source ID returns all emails in the group.

Threads also span the merge group. If a reply arrived via a different source than the original message, it still appears in the correct thread.

## How Syncing Works

Each source syncs **independently**. The scheduler picks up all sources with status `active` or `error`, regardless of whether they are merged.

- File-based imports (PST, EML, Mbox) finish with status `imported` and are never re-synced automatically.
- Live sources (IMAP, Google Workspace, Microsoft 365) continue their normal sync cycle.

When you trigger **Force Sync** on a root source, the system also queues a sync for all non-file-based children that are currently `active` or `error`.

## Deduplication Across the Group

When ingesting emails, duplicate detection covers the **entire merge group**. If the same email (matched by its RFC `Message-ID` header or provider-specific ID) already exists anywhere in the group, it is skipped and not stored again.

## Preserve Original File (GoBD Compliance) and Merged Sources

The **Preserve Original File** setting on the root source governs the entire group. When this setting is enabled on the root:

- All emails ingested by child sources are also stored unmodified (raw EML, no attachment stripping).
- The child's own `preserveOriginalFile` setting has no effect — the root's setting is always used.

This ensures consistent compliance behaviour across the group. If you require GoBD or SEC 17a-4 compliance for an entire merged group, enable **Preserve Original File** on the root source before adding any children.

## Editing Sources in a Group

Each source in a group can be edited independently. Expand the group row in the Ingestions table by clicking the chevron, then use the **⋮** actions menu on the specific source (root or child) you want to edit.

## Unmerging a Child Source

To detach a child from its group and make it standalone:

1. Expand the group row by clicking the chevron next to the root source name.
2. Open the **⋮** actions menu on the child source.
3. Click **Unmerge**.

The child becomes an independent root source. No email data is moved or deleted.

> **Note:** Because all emails fetched by the child were stored under the root source's ID, unmerging the child does not transfer those emails. Historical emails ingested while the source was a child remain owned by the root. Only new emails ingested after unmerging will be stored under the (now standalone) child.

## Deleting Sources in a Group

- **Deleting a root source** also deletes all its children: their configuration, and all emails, attachments, storage files, and search index entries owned by the root are all removed. Because all group emails are stored under the root, this effectively removes the entire group's archive.
- **Deleting a child source** removes only the child's configuration and sync state. Emails already ingested by the child are stored under the root and are **not** deleted.

A warning is shown in the delete confirmation dialog when a root source has children.

## Known Limitations

- **Merging existing standalone sources is not supported.** You can only merge a source into a group at creation time. To merge two existing sources, you must delete one and recreate it with the merge target selected.
- **Historical data from a child source before unmerging remains with the root.** If you unmerge a child, emails it previously ingested stay owned by the root and are not migrated to the child.
