# Connecting Email Providers

Open Archiver can connect to a variety of email sources to ingest and archive your emails. This section provides guides for connecting to popular email providers.

Choose your provider from the list below to get started:

- [Google Workspace](./google-workspace.md)
- [Microsoft 365](./microsoft-365.md)
- [Generic IMAP Server](./imap.md)
- [EML Import](./eml.md)
- [PST Import](./pst.md)
- [Mbox Import](./mbox.md)
- [Merging Ingestion Sources](./merging-sources.md)

## What gets archived

### Drafts

Unsent drafts from live mailboxes — Google Workspace, Microsoft 365 and IMAP — are **not archived by default**. A draft is not a record of anything: it was never sent, and it changes every time its author touches it. Archiving one goes wrong in both directions, depending on the provider.

Google replaces the underlying message on every save, so each auto-save arrives as a new message with new identifiers. Archived, they accumulate: one email that is still being written can leave a dozen copies behind, plus one more when it is finally sent.

Many IMAP servers do the opposite and keep a single Message-ID from the first save through to the sent message. The draft is archived first, and the message that was actually sent is then taken for a duplicate of it — so the archive keeps an unfinished body and never learns what was really sent.

Set `ARCHIVE_DRAFTS=true` if you need drafts kept. Note that both behaviours above come back with it.

**File imports are not affected.** A PST, EML or mbox file is a snapshot you chose to hand over, and it is imported once rather than polled, so neither problem applies. Everything in the file is archived, drafts included, whatever `ARCHIVE_DRAFTS` is set to.

### Junk and Trash

Junk and Trash folders are excluded by default on IMAP. Set `ALL_INCLUSIVE_ARCHIVE=true` to include them. This setting is separate from `ARCHIVE_DRAFTS` — asking for spam to be archived is not the same as asking for half-written messages.
