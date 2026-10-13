# Seat Counting

Open Archiver Enterprise is licensed per seat. A seat is one person whose emails are archived. This page explains how Open Archiver calculates the number of seats, which settings administrators can change, and what information is sent to the license server.

## Overview

Open Archiver counts people, not mailboxes. Two adjustments make the seat count lower than the number of archived mailboxes:

- Shared mailboxes, role addresses such as `info@`, meeting rooms and equipment are not counted.
- Several addresses that belong to the same person are counted as one seat.

The **Seats** page is also available in the Open Source Edition, so you can see how many seats an Enterprise license would need before you buy one. The figure is calculated from the mailboxes already in your archive. On the Open Source Edition, nothing is reported to Open Archiver and nothing is enforced.

## Which mailboxes count

A mailbox counts as a seat when it holds archived emails and belongs to a person. Each mailbox is classified by the first rule below that applies:

| Order | Rule                                                                                                   | Result     |
| ----- | ------------------------------------------------------------------------------------------------------ | ---------- |
| 1     | The address is a placeholder created by journaling when the owner of an email could not be determined. | Not a seat |
| 2     | An administrator has marked the mailbox as a person.                                                   | Seat       |
| 3     | The part of the address before `@` is a role name (see below).                                         | Not a seat |
| 4     | Microsoft 365 reports the mailbox as shared, a room or equipment.                                      | Not a seat |
| 5     | An administrator has marked the mailbox as shared.                                                     | Not a seat |
| 6     | None of the above.                                                                                     | Seat       |

Mailboxes that hold no archived emails are never counted, even if your directory lists them.

### Role names

A mailbox is treated as a role mailbox when the part of its address before `@` exactly matches one of these names:

`postmaster`, `hostmaster`, `webmaster`, `abuse`, `noc`, `security`, `usenet`, `news`, `uucp`, `ftp`, `sales`, `marketing`, `support`, `info`, `contact`, `noreply`, `no-reply`, `no_reply`, `donotreply`, `do-not-reply`, `admin`, `billing`, `hr`, `jobs`, `careers`, `newsletter`, `notifications`, `alerts`, `helpdesk`, `service`, `office`, `hello`, `mailer-daemon`, `team`

The list is based on RFC 2142 and common practice. Only exact matches count: `support@example.com` is a role mailbox, `support2@example.com` is not.

Administrators can add names to this list on the Seats page. The built-in names cannot be removed. If a person uses one of these addresses, mark that mailbox as a person.

### Microsoft 365

Open Archiver reads the mailbox type from Microsoft 365 when the **MailboxSettings.Read** application permission is granted. Shared mailboxes, rooms and equipment are then recognized automatically.

Without this permission, Open Archiver uses the license state instead. An account that has no license but still has a mailbox is treated as a shared mailbox, because that is how Exchange stores shared mailboxes. An account with a license is treated as a person.

### Google Workspace, IMAP and imported files

These sources do not report whether a mailbox is shared. Role names apply as usual, and an administrator can mark any other mailbox as shared.

## Counting several addresses as one person

Open Archiver counts the following as a single seat:

- **Aliases from your directory.** Microsoft 365 proxy addresses and Google Workspace aliases are read automatically.
- **Organization domains.** On the Seats page, add a domain group with a primary domain and at least one alias domain. `john@example.com` and `john@example.org` then count as one seat. Domains configured on journaling sources are included automatically.
- **Manual links.** An administrator can link two mailboxes that belong to the same person, for example a PST import and the person's live mailbox.

## Restrictions

The following changes are not allowed, so that the seat count can be verified:

- A mailbox that Microsoft 365 has classified, or that belongs to a licensed Microsoft 365 account, cannot be marked as shared. Change the mailbox in Microsoft 365 instead.
- Two separate accounts from the same directory cannot be combined into one seat, through domain groups or manual links.
- Built-in role names cannot be removed.

Every change an administrator makes on the Seats page is recorded in the audit log, with the user who made it.

## Information sent to the license server

Enterprise deployments contact the license server once a day, and when the application starts. The request contains:

- the license identifier, a deployment identifier and the software version
- the number of seats
- counts that explain the number of seats, such as how many mailboxes were excluded by each rule and how many addresses were combined
- a one-way hash of each role name an administrator added, for example `frontdesk`

**No email addresses are sent, in plain text or hashed.** No names, emails or attachments are sent either. The list of mailboxes that administrators have marked stays on your deployment, in the Seats page and the audit log.

If the license server considers the number of manual exclusions unusual, a warning appears on the **License Status** page. No features are disabled because of this warning.

## Frequently asked questions

**Do we still pay for someone who has left?**
Yes, as long as their emails are kept in the archive. Removing their account from your directory does not delete the archived emails. The seat is released when the emails are deleted, for example by a retention policy. Mailboxes that your directory has not listed for 30 days are shown on the Seats page.

On Microsoft 365, if you remove a person's license before you delete their account, the mailbox looks like a shared mailbox for a short time. Once Microsoft 365 has not listed the account for 30 days, it counts as a seat again.

**Is each imported PST file a seat?**
Yes, unless you link it to another mailbox. If the person also has a live mailbox in the archive, link the two and they count as one seat.

**Google charges us for `contact@`. Does Open Archiver?**
No. `contact` is a role name, so the mailbox is not counted.

**We run several application servers. Are seats counted per server?**
No. All servers that share one database are one deployment with one seat count.

## The Seats page

Go to **Dashboard → Admin → Seats** to see:

- the number of seats and the number of archived mailboxes
- the breakdown of excluded and combined mailboxes
- every mailbox, with the rule that decided whether it counts
- the organization domains and additional role names

The seat count is recalculated before each daily license check. When you open the Seats page and the figures are more than 10 minutes old, the page shows the previous figures and recalculates in the background; reload the page to see the result. Click **Recount** to recalculate immediately.
