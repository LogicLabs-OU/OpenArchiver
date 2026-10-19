# Connecting a JMAP Mailbox

[JMAP](https://jmap.io) is a modern, HTTP-based replacement for IMAP. Fastmail offers it, as do servers built on [Stalwart](https://stalw.art), Cyrus IMAP and Apache James. A JMAP source archives one mailbox, like a [Generic IMAP](./imap.md) source, but asks the server only for what changed since the last sync instead of scanning every folder.

## What you need

- **Server URL:** the address of the JMAP server. Open Archiver reads the server's settings from `/.well-known/jmap` under that address.
- **Username:** the mailbox's email address.
- **A credential**, one of:
    - an **API token**, sent as a Bearer token. Fastmail uses this.
    - a **password**, sent with HTTP Basic authentication. Use an app password where the server offers one, as Stalwart does, rather than the account's main password.

### Fastmail

1. In Fastmail, go to **Settings → Privacy & Security → Manage API tokens** and create a new token.
2. Give it read access to **Mail**. Open Archiver never writes to the mailbox.
3. Copy the token; Fastmail shows it only once.

Use the server URL `https://api.fastmail.com`, your Fastmail address as the username, and **API token** as the authentication.

### Stalwart

1. Sign in to Stalwart's self-service portal and open **App Passwords**.
2. Create one for Open Archiver and copy it.

Use your Stalwart server's address (for example `https://mail.example.com`) as the server URL, your email address as the username, and **Password or app password** as the authentication.

## Step-by-Step Guide

1.  From the main dashboard, go to the **Ingestions** page and click **Create New**.
2.  Fill in the form:
    - **Name:** a name you will recognize, such as "Fastmail (JMAP)".
    - **Provider:** select **JMAP**.
    - **Server URL**, **Username**, **Authentication** and the **API token** or **Password**, as described above.
3.  Click **Save changes**. Open Archiver connects to the server straight away and only saves the source if the connection works.

## What gets archived

The same folders as for IMAP. Mail in the **Drafts**, **Junk** and **Trash** mailboxes is left out by default; set `ARCHIVE_DRAFTS=true` or `ALL_INCLUSIVE_ARCHIVE=true` to include them (see [What gets archived](./index.md#what-gets-archived)). A message filed in several mailboxes is archived once, under the first mailbox, with the others recorded as tags.

## How syncing works

The first sync lists and archives every message. After that, each sync asks the server for the messages created or changed since the previous sync, so a quiet mailbox costs a handful of requests. If the server no longer remembers that point (servers keep it for at least 30 days), Open Archiver lists the whole mailbox again and skips everything already archived.

## Limitations

- One mailbox per source. Add one source per mailbox you want to archive.
- The server's TLS certificate must be trusted by the machine running Open Archiver. For a private certificate authority, point `NODE_EXTRA_CA_CERTS` at its certificate.
- Signing in with OAuth is not supported yet; use an API token or app password.
