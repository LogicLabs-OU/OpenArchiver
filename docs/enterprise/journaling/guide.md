# SMTP Journaling

SMTP Journaling allows Open Archiver to receive journal reports directly from your corporate mail transfer agent (MTA) — such as Microsoft Exchange, Microsoft 365, or Postfix — via an embedded SMTP listener. This provides a real-time, unaltered copy of every email including BCC and envelope routing data.

## Overview

When journaling is enabled, Open Archiver runs an embedded SMTP server alongside the main application. Your MTA is configured to send journal reports to a unique routing address for each journaling source. The SMTP listener validates each connection by IP whitelist, optional TLS, and optional SMTP AUTH credentials before accepting the email and queuing it for archival processing.

## Prerequisites

- Open Archiver Enterprise license with the **Journaling** feature enabled.
- A domain or subdomain with an **MX record** pointing to the server running Open Archiver (e.g., `journal.yourdomain.com`).
- Network/firewall rules allowing inbound SMTP traffic on the configured port (default: `2525`).

## Environment Variables

Add the following to your `.env` file:

| Variable                               | Default     | Description                                                                                                                                                    |
| -------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_JOURNALING_PORT`                 | `2525`      | The port the SMTP listener binds to inside the container. The `docker-compose.yml` maps this to the host.                                                      |
| `SMTP_JOURNALING_DOMAIN`               | `localhost` | The domain used to generate routing addresses (e.g., `journal-abc12345@journal.yourdomain.com`). Set this to the domain whose MX record points to this server. |
| `JOURNAL_QUEUE_BACKPRESSURE_THRESHOLD` | `10000`     | Maximum waiting jobs before the listener returns 4xx temporary failures.                                                                                       |

## Docker Deployment

The `docker-compose.yml` exposes the SMTP port on the host:

```yaml
ports:
    - '25:${SMTP_JOURNALING_PORT:-2525}'
```

The host-side port is configurable via `.env`. The container-side port is fixed at `25`, which is the default SMTP listening port.

### Firewall Configuration

Ensure your server's firewall allows inbound TCP on the SMTP listening port:

```bash
# UFW example
sudo ufw allow 25/tcp

# iptables example
sudo iptables -A INPUT -p tcp --dport 25 -j ACCEPT
```

If using a cloud provider (AWS, GCP, Azure), add an inbound rule to your security group or firewall for TCP port `25` (or your custom port).

## DNS Configuration

Create an MX record for the journaling subdomain pointing to your Open Archiver server:

```
journal.yourdomain.com.  IN  MX  10  archiver.yourdomain.com.
```

Where `archiver.yourdomain.com` resolves to the IP address of your Open Archiver server.

## Creating a Journaling Source

1. Navigate to **Dashboard → Ingestions → Journaling** in the Open Archiver UI.
2. Click **Create Journaling Source**.
3. Configure:
    - **Name**: A descriptive name (e.g., "Exchange Production").
    - **Allowed IPs**: The IP addresses or CIDR blocks of your MTA servers (e.g., `10.0.0.0/8`, `203.0.113.50`).
    - **Require TLS**: Enable if your MTA supports STARTTLS (recommended for GDPR compliance).
    - **Organization Domains** (optional): Define domain groups to correctly identify which inbox each journaled email belongs to. See [Organization Domain Groups](#organization-domain-groups) for details.
    - **SMTP Username / Password** (optional): If set, the sending MTA must authenticate with these credentials before delivering journal reports. If the sender does not authenticate, the email is rejected.
4. After creation, the UI displays a **Routing Address** (e.g., `journal-abc12345@journal.yourdomain.com`). Configure this address as the journal recipient in your MTA.

## Editing a Journaling Source

When editing a source that has an SMTP password configured:

- The password field is always empty when the edit form opens (the existing password is stored as a bcrypt hash and cannot be retrieved).
- If a password is currently set, the form shows a hint: **"A password is currently set. Leave this field blank to keep it, or type a new password to replace it."**
- To **keep the existing password**: leave the password field blank and save.
- To **change the password**: type the new password and save.
- To **remove password authentication entirely**: clear the username field and leave the password field blank, then save. Both fields being empty disables SMTP AUTH for that source.

---

## Organization Domain Groups

Organization Domain Groups tell Open Archiver which email addresses belong to your organization. This is used to determine **which inbox (`userEmail`) a journaled email is filed under** — a value that drives IAM access control (who can search which emails) and Meilisearch scoping.

### Why This Matters

A journal report received via SMTP contains all participants: To, CC, BCC, and From. Open Archiver must decide which of those addresses is the "owner" — the internal inbox the email belongs to. Without domain configuration, it uses a simple heuristic (first To address). With domain groups configured, it correctly identifies internal recipients even when your organization uses multiple domains or has migrated from an old domain.

### Structure

Each domain group has:

- **Primary domain** (`main`): The canonical domain used for storage and search. All email addresses from alias domains are normalized to this domain before being stored.
- **Alias domains** (`aliases`): Zero or more additional domains that belong to the same organization. Addresses at these domains are treated identically to the primary domain.

**Example configuration:**

```json
[
	{
		"main": "company.com",
		"aliases": ["company.co.uk", "old-brand.com"]
	},
	{
		"main": "subsidiary.io",
		"aliases": []
	}
]
```

Multiple groups are supported — useful when your Open Archiver instance archives emails for multiple organizations or subsidiaries.

### How Owner Resolution Works

For each inbound journaled email, Open Archiver resolves the owner address using the following priority order:

1. **Inbound check (To / CC / BCC)**: Scan all recipient addresses in order (To first, then CC, then BCC). The first recipient whose domain matches any configured domain (either `main` or an `alias`) is selected as the owner.

2. **Outbound check (From)**: If no recipient matched, check whether the sender's domain matches a configured domain. If so, the email is outgoing from an internal mailbox and the sender is the owner.

3. **Fallback (no groups configured)**: If no domain groups are configured at all, a simple heuristic is used: `To[0] → CC[0] → BCC[0] → From[0] → 'journal-unknown'`.

4. **No match with groups configured**: If domain groups exist but no participant matched any of them (e.g., a forwarded external email with no internal participants), the address is set to `default_fallback@<primary domain of first group>` and a warning is logged.

### Domain Normalization (Alias Handling)

When an owner is matched via an alias domain, the address is automatically normalized to the primary domain before being stored. This ensures that emails sent to `user@old-brand.com` and emails sent to `user@company.com` are stored under the same mailbox identity.

**Example:**

| Journaled email recipient | Configured group                                      | Stored `userEmail`             |
| ------------------------- | ----------------------------------------------------- | ------------------------------ |
| `alice@old-brand.com`     | `{ main: "company.com", aliases: ["old-brand.com"] }` | `alice@company.com`            |
| `alice@company.com`       | `{ main: "company.com", aliases: ["old-brand.com"] }` | `alice@company.com`            |
| `bob@subsidiary.io`       | `{ main: "subsidiary.io", aliases: [] }`              | `bob@subsidiary.io`            |
| `external@gmail.com`      | _(no match)_                                          | `default_fallback@company.com` |

### Practical Scenarios

**Single domain, no migration:**
Leave Organization Domains empty. The system uses the heuristic `To[0]` address. This works correctly for most single-domain setups.

**Domain migration or rebrand:**
Your company moved from `old-brand.com` to `company.com`. Configure:

```
main: company.com
aliases: old-brand.com
```

Emails addressed to either domain are now filed under `company.com` addresses, giving users a unified view of their archive regardless of when the email was sent.

**Multiple alias domains (e.g., regional TLDs):**

```
main: company.com
aliases: company.co.uk, company.de, company.fr
```

**Multiple subsidiaries, one Open Archiver instance:**
Create two groups:

```
Group 1: main: parent.com,      aliases: []
Group 2: main: subsidiary.io,   aliases: [sub-old.com]
```

---

## MTA Configuration Examples

### Google Workspace

Google Workspace does not have a native journaling feature like Exchange. Instead, use a **Routing** rule to deliver a copy of all email to the Open Archiver journaling address:

1. In the Google Admin Console, go to **Apps → Google Workspace → Gmail → Routing**.
2. Under **Routing**, click **Configure** (or **Add another rule**).
3. Configure the rule:
    - **Name**: "Journal to Open Archiver"
    - **Email messages to affect**: Select **Inbound**, **Outbound**, and **Internal - sending** as needed.
    - Under **For the above types of messages, do the following**, select **Modify message**.
    - Check **Also deliver to** → **Add more recipients** → enter the routing address from Open Archiver (e.g., `journal-abc12345@journal.yourdomain.com`).
    - For the added recipient, click **Advanced settings** → **Change route** and configure the SMTP route to point to `archiver.yourdomain.com` on port `2525`. Enable **Require TLS** if your journaling source has TLS enabled.
    - Optionally check **Do not deliver spam to this recipient** to avoid archiving spam.
4. Click **Save**.

> **Note**: Changes to Gmail routing rules may take up to 24 hours to propagate across all users. For the allowed IPs in your journaling source, use Google's SMTP relay IP ranges (see [Google IP ranges](https://support.google.com/a/answer/60764)).

### Microsoft 365 / Exchange Online

1. In the Exchange Admin Center, go to **Compliance Management → Journal Rules**.
2. Create a new journal rule:
    - **Send journal reports to**: The routing address from Open Archiver (e.g., `journal-abc12345@journal.yourdomain.com`).
    - **Scope**: Select "All messages" or scope to specific users/groups.
3. Ensure your Exchange connector allows outbound SMTP to the Open Archiver server on port `2525`.

### On-Premises Exchange

1. Open the Exchange Management Shell.
2. Create a journal rule:
    ```powershell
    New-JournalRule -Name "Open Archiver" -JournalEmailAddress "journal-abc12345@journal.yourdomain.com" -Scope Global -Enabled $true
    ```
3. Create a Send Connector for the journaling subdomain pointing to the Open Archiver server's IP and port.

### Postfix

Add a transport map entry to route journal emails to the Open Archiver SMTP listener:

```
# /etc/postfix/transport
journal.yourdomain.com    smtp:[archiver.yourdomain.com]:2525
```

Then run `postmap /etc/postfix/transport` and reload Postfix.

---

## Security Considerations

### Authentication

Each journaling source can optionally require SMTP AUTH (username + password). When credentials are configured on a source, the sending MTA **must** authenticate before delivering email. Unauthenticated connections are rejected at the RCPT TO stage.

Sources without credentials configured rely solely on IP whitelisting for access control.

Passwords are stored as bcrypt hashes in the database and are never returned by the API. When editing a source in the UI, the password field is always empty — see [Editing a Journaling Source](#editing-a-journaling-source) for instructions on changing or clearing a password.

### IP Whitelisting

Every connection is validated against the IP whitelist in two stages:

1. **onConnect**: Rejects IPs not whitelisted by _any_ active source (early filter).
2. **onRcptTo**: After resolving the specific source by routing address, validates the IP against _that source's_ whitelist.

### TLS

When `requireTls` is enabled on a source, connections without TLS (STARTTLS) are rejected. This is recommended for compliance with GDPR and other data protection regulations.

---

## Health Check

The SMTP listener exposes a health endpoint:

```
GET /v1/enterprise/journaling/health
```

Returns `200` with `{ "smtp": "listening", "port": "2525" }` when healthy, or `503` when the listener is down.

---

## Troubleshooting

### SMTP listener not starting

Check the application logs for errors like "Failed to start SMTP journaling listener". Common causes:

- Port already in use by another process.
- Missing database migration (the `journaling_sources` table must exist).
- The Journaling feature is not enabled in the license.

### Emails not being received

1. Verify the MX record resolves correctly: `dig MX journal.yourdomain.com`
2. Verify the port is reachable: `telnet archiver.yourdomain.com 2525`
3. Check the allowed IPs on the journaling source match the MTA's outbound IP.
4. If SMTP AUTH is configured, ensure the MTA is sending credentials.
5. Check application logs for rejection messages (IP not whitelisted, TLS required, authentication required).

### Emails filed under wrong mailbox

If archived emails are appearing under unexpected mailbox addresses (e.g., `default_fallback@company.com` or an external sender's address), the **Organization Domains** configuration may be missing or incomplete.

1. Edit the journaling source and add Organization Domain Groups covering your company's domains.
2. If you have alias or legacy domains, add them as aliases under the correct primary domain.
3. New emails received after saving will use the updated configuration. Previously archived emails are not retroactively re-filed.

### Queue backpressure (4xx errors)

If the MTA receives temporary 4xx failures, the journal-inbound queue has exceeded the backpressure threshold. This means workers can't keep up with inbound volume. Solutions:

- Increase `JOURNAL_QUEUE_BACKPRESSURE_THRESHOLD` if the server has capacity.
- Scale up the journaling worker processes.
- Check for processing errors in the worker logs.
