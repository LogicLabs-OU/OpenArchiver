# OAuth Mailbox (Outlook.com and personal accounts)

The **OAuth Mailbox** provider archives a single mailbox, signing in with OAuth 2.0 the way a modern email client does — no password stored, no app passwords. It exists because Microsoft has retired basic authentication entirely: a personal Outlook.com or Hotmail mailbox can no longer be added as a [Generic IMAP](./imap.md) source at all.

Two built-in Microsoft presets are provided. **Outlook.com / Microsoft personal** covers Outlook.com, Hotmail and Live.com mailboxes; **Microsoft work or school** covers one mailbox inside a Microsoft 365 organization. Both fetch mail over **Microsoft Graph** rather than IMAP — see [Why Microsoft mailboxes use Graph](#why-microsoft-mailboxes-use-graph). The **Custom** preset works with any mail server that accepts IMAP XOAUTH2, and you supply the endpoints yourself.

## When to use this instead of Microsoft 365

|               | OAuth Mailbox                                     | [Microsoft 365](./microsoft-365.md)            |
| ------------- | ------------------------------------------------- | ---------------------------------------------- |
| Scope         | One mailbox                                       | Every mailbox in the tenant                    |
| Account types | Personal (Outlook.com, Hotmail) and work accounts | Organization tenants only                      |
| Consent       | The mailbox owner signs in and consents           | A tenant admin grants application-wide consent |
| Credentials   | OAuth tokens, refreshed automatically             | Client secret with application permissions     |
| Protocol      | Microsoft Graph, or IMAP (XOAUTH2) for others     | Microsoft Graph                                |

Rule of thumb: archiving **your own or one person's mailbox** → OAuth Mailbox. Archiving **an organization** → Microsoft 365.

## The two authorization methods

When creating the source you choose how the sign-in happens:

- **Sign in via browser** (authorization code flow): you are redirected to the provider's sign-in page and returned to Open Archiver afterwards. Requires your Open Archiver instance to be reachable at its public URL (`APP_URL`), and that exact URL registered as a redirect URI with the provider.
- **Enter a code on another device** (device code flow): Open Archiver shows you a short code and a link; you open the link on any device, enter the code and sign in. Nothing needs to reach your instance from outside, so this works for instances on private networks or `localhost`.

Either way, Open Archiver stores the granted tokens encrypted, refreshes them automatically during syncing, and starts the initial import the moment the sign-in completes.

> **The device method depends on your provider offering it, and for which scopes.** Microsoft offers it for everything this provider needs. Google does not: its device flow accepts only seven scopes, none of them Gmail's, so a Gmail source has to use the browser method. See [Custom preset](#custom-preset).

## Example: Outlook.com

This walks through archiving a personal Outlook.com mailbox end to end. You need a (free) Azure account to register the app — the mailbox itself does not need to be an Azure or Microsoft 365 account.

### Step 1 — Register an application in Azure

1. Open [portal.azure.com](https://portal.azure.com) and go to **Microsoft Entra ID → App registrations → New registration**.
2. Give it any name, e.g. `Open Archiver`.
3. Under **Supported account types**, choose the narrowest option that covers your mailbox:
    - **Personal Microsoft accounts only** for Outlook.com, Hotmail and Live.com. Recommended — it matches the preset's sign-in realm exactly and removes a whole class of failure described below.
    - **Accounts in this organizational directory only** for a mailbox inside your Microsoft 365 organization.
    - **Accounts in any organizational directory and personal Microsoft accounts** only if one registration must serve both. Read [Choosing the right preset](#choosing-the-right-preset) before picking this.
4. Leave the redirect URI empty for now and click **Register**.
5. On the overview page, note the **Application (client) ID** — you will paste it into Open Archiver.

A personal Microsoft account gets a directory of its own the first time it opens the portal, and registering the application there is fine. Nothing in the steps below needs a Microsoft 365 subscription or an Exchange Online tenant.

### Step 2 — Configure the sign-in method

**For "Sign in via browser":**

1. Go to **Authentication → Add a platform → Web**.
2. Enter the redirect URI exactly as your instance forms it:
    ```
    https://your-archiver-domain.com/api/v1/oauth/callback
    ```
    This must match your `APP_URL` setting character for character — the create form shows you the exact value to register.
3. Go to **Certificates & secrets → New client secret**, create one, and copy its **Value** (not the ID). You will paste it into the form's Client secret field.

> **No client secret?** A redirect URI registered under the **Web** platform makes Azure treat the app as a confidential client, and the token exchange then fails with `AADSTS7000218` if no secret is sent. If you prefer to run without a secret, register the redirect URI under **Mobile and desktop applications** instead of Web — that classifies the app as a public client and the PKCE exchange needs no secret.

**For "Enter a code on another device":**

1. Go to **Authentication → Advanced settings**.
2. Set **Allow public client flows** to **Yes** and save.
3. No redirect URI is needed.
4. Do **not** create a client secret. The device code flow is a public-client flow; a secret turns the registration into a confidential client and the flow then fails. Open Archiver hides the client secret field whenever this method is selected, for that reason — so a provider whose device flow does require a secret needs the browser method instead.

### Step 3 — API permissions

**You can skip this step.** The permissions Open Archiver needs are Microsoft Graph _delegated_ permissions, the sign-in request names them directly, and you grant them on the consent screen during sign-in. Nothing has to be declared in advance.

Declaring them anyway is harmless and pre-fills the consent screen. It becomes necessary only in an organization whose tenant requires an administrator to consent on a user's behalf:

1. In the left sidebar choose **API permissions** — this is the blade for requesting permissions _from_ other APIs. Do not use **Expose an API**, which sits directly below it and is for publishing scopes _of your own_.
2. Click **Add a permission → Microsoft Graph → Delegated permissions**.
3. Tick **Mail.Read**, **User.Read**, **offline_access**, **openid** and **profile**.
4. If your tenant requires administrator consent, have an admin grant it before connecting the mailbox.

Microsoft Graph is listed in every directory, including the one a personal Microsoft account gets, so there is nothing here that can come up "No results found".

Open Archiver requests these scopes at sign-in:

| Scope                                   | What it is for                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `https://graph.microsoft.com/Mail.Read` | Reads the signed-in mailbox: folders, messages, and the original MIME of each message.                                    |
| `https://graph.microsoft.com/User.Read` | Reads the signed-in account's own profile, used to confirm which mailbox was authorized.                                  |
| `offline_access`                        | Lets Microsoft issue a refresh token, so syncing continues after the access token expires.                                |
| `openid profile`                        | Returns the address the token was issued for, so a sign-in with the wrong account is caught rather than archived quietly. |

A **Custom** preset source uses IMAP instead, and needs whatever IMAP scope its own provider defines — for Microsoft that would be `https://outlook.office.com/IMAP.AccessAsUser.All`, declared under _Office 365 Exchange Online_ rather than Microsoft Graph.

### Step 4 — IMAP settings on the mailbox

**Not needed for the Microsoft presets.** They fetch over Graph, which is unaffected by the mailbox's IMAP setting.

It matters only if you connect a mailbox over IMAP through the **Custom** preset. Microsoft leaves IMAP off by default on Outlook.com accounts, so in that case:

1. Sign in to [outlook.com](https://outlook.com) as the mailbox you are archiving.
2. Open **Settings → Mail → Forwarding and IMAP**.
3. Under **POP and IMAP**, turn on **Let devices and apps use IMAP**.
4. Save.

Turning it on does not make Microsoft's IMAP service reliable for personal accounts — see [Why Microsoft mailboxes use Graph](#why-microsoft-mailboxes-use-graph).

### Step 5 — Create the source in Open Archiver

1. Go to **Ingestions → Create ingestion source**.
2. Choose the provider **OAuth Mailbox**, then pick the preset that matches the mailbox — **Outlook.com / Microsoft personal** is selected by default and fills in every endpoint for you. The form shows which transport that preset uses.
3. Pick your authorization method.
4. Enter the **mailbox address** and the **Application (client) ID** from step 1. The client secret field appears only for the browser method, and only then if your registration needs one.
5. Submit.
    - Browser flow: you are sent to the Microsoft sign-in page. Sign in **with the mailbox you want to archive**, accept the requested permissions, and you are returned to Open Archiver.
    - Device flow: a dialog shows a code and a link to [microsoft.com/devicelogin](https://microsoft.com/devicelogin). Enter the code there, sign in, and the dialog completes by itself.
6. Open Archiver opens one connection to the mailbox to confirm the authorization worked. If that first connection is refused you are told so, and the source is authorized anyway — syncing retries on its own rather than waiting for you.
7. The initial import starts immediately, and the mailbox then stays in continuous sync.

Sign in with the mailbox you entered in step 5. Open Archiver reads the address the token was issued for and archives that mailbox — if the two differ, the status message says so.

## Re-authorization

OAuth access can die outside Open Archiver's control: you revoke the app's access in your [Microsoft account settings](https://account.live.com/consent/Manage), the password changes, or a personal-account refresh token simply expires after around 90 days without syncing. When that happens the source's status turns to **error**, and the status message tells you to re-authorize.

Open the source's action menu (⋯) and click **Re-authorize**. That runs the same sign-in you did at setup; already-archived mail is untouched, and the sync picks up where it left off.

Editing a source's **name** or other settings never touches the authorization. Changing its **connection settings** (mailbox address, client ID, endpoints, scopes) invalidates the stored tokens by design, and the source asks to be re-authorized.

## Why Microsoft mailboxes use Graph

Microsoft's IMAP service refuses sessions on personal Outlook.com mailboxes at random. The sign-in succeeds, the token is valid, the identity resolves — and the server then answers `User is authenticated but not connected` instead of opening the mailbox.

Microsoft Graph is unaffected. It reads the same mailbox over HTTPS, returns the original MIME of each message — which is what an archive stores — and supports incremental delta sync. Both Microsoft presets therefore use Graph, and the IMAP host and port fields do not apply to them.

IMAP remains the transport for the **Custom** preset and for every other provider. Nothing about this is Microsoft-specific beyond Microsoft.

## Choosing the right preset

The two Microsoft presets read the same mailbox the same way. They differ in the sign-in realm named in their endpoints, and that decides which identity the token belongs to:

| Preset                           | Endpoints                                     | Use it for                                  |
| -------------------------------- | --------------------------------------------- | ------------------------------------------- |
| Outlook.com / Microsoft personal | `login.microsoftonline.com/consumers/...`     | Outlook.com, Hotmail, Live.com              |
| Microsoft work or school         | `login.microsoftonline.com/organizations/...` | One mailbox in a Microsoft 365 organization |

Neither uses `/common`. An address can exist twice — once as a personal Microsoft account and once as an account in some directory — and `/common` lets Microsoft resolve it to the directory one, which usually owns no mailbox at all. Pinning the realm removes the ambiguity.

If you must serve both kinds of mailbox from one app registration, register it for both account types and create one ingestion source per mailbox on the matching preset.

A source created before Graph existed keeps fetching over IMAP, because the transport is stored per source. To move it to Graph: edit the source, turn on **Update connection settings**, pick the preset again, and save. The source returns to **pending auth** and asks to be re-authorized, because Graph needs different scopes than IMAP. Archived mail is untouched.

## Custom preset

Choose **Custom** to connect any other server that speaks IMAP with SASL XOAUTH2. Nothing in the sign-in machinery is Microsoft-specific — it is plain OAuth 2.0 — so any provider that issues OAuth tokens for IMAP works here. Custom sources always fetch over IMAP; Graph is Microsoft's API and is offered only by the Microsoft presets.

You supply:

| Field                  | What it is                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Authorization endpoint | The provider's OAuth authorization URL                                                |
| Token endpoint         | The provider's OAuth token URL                                                        |
| Device code endpoint   | Only needed for the device-code method                                                |
| Scopes                 | Space-separated; must include the provider's IMAP scope and its offline/refresh scope |
| IMAP host / port       | The server the mail is fetched from (TLS is always used)                              |

### Gmail

| Field                  | Value                                          |
| ---------------------- | ---------------------------------------------- |
| Authorization endpoint | `https://accounts.google.com/o/oauth2/v2/auth` |
| Token endpoint         | `https://oauth2.googleapis.com/token`          |
| Scopes                 | `https://mail.google.com/`                     |
| IMAP host / port       | `imap.gmail.com` / `993`                       |
| Authorization method   | **Sign in via browser** — see below            |

Create the OAuth client in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), and note three things Google does differently from Microsoft:

- **Use the browser method.** Google's device flow accepts only `email`, `openid`, `profile`, `drive.appdata`, `drive.file`, `youtube` and `youtube.readonly`. No Gmail scope is on that list, so a device-code request for `https://mail.google.com/` is rejected outright ([Google's device-flow documentation](https://developers.google.com/identity/protocols/oauth2/limited-input-device)).
- **A client secret is required**, even for a Desktop app client. Enter it in the form.
- **Publish the OAuth consent screen.** Left in _Testing_ mode, Google expires refresh tokens after seven days, which means re-authorizing every week.

## Troubleshooting

| Symptom                                                              | Cause and fix                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AADSTS50011` after signing in                                       | The redirect URI registered in Azure does not exactly match `{APP_URL}/api/v1/oauth/callback`. Fix the registration (scheme, host and path must all match).                                                                                                                                                                                                             |
| `AADSTS7000218` during token exchange                                | The registration is a confidential client but no secret was sent. Browser flow: add the secret to the form, or re-register the redirect URI under Mobile and desktop applications. Device flow: set **Allow public client flows** to **Yes** (step 2) — that method sends no secret by design.                                                                          |
| `AADSTS700016`                                                       | The Application (client) ID is wrong, or the app registration does not allow the account type you signed in with.                                                                                                                                                                                                                                                       |
| Sign-in works but the sync errors with `403` or a permission failure | The mail scope was not granted. Sign in again with **Re-authorize** and accept the mail permission on the consent screen. In an organization, confirm delegated **Mail.Read** is on the registration and that an admin consented.                                                                                                                                       |
| `User is authenticated but not connected`                            | Only reachable on an IMAP source. Microsoft's IMAP service accepted the token and then declined to open the mailbox — intermittent on personal accounts and outside anyone's control, see [Why Microsoft mailboxes use Graph](#why-microsoft-mailboxes-use-graph). Syncing retries on its own. If it persists, move the source to a Microsoft preset, which uses Graph. |
| Status message names a different address than the one you entered    | You signed in with another account. Use **Re-authorize** and sign in as the mailbox you want archived, or change the source's mailbox address to match.                                                                                                                                                                                                                 |
| Source stuck in **pending auth**                                     | The authorization was started but never finished. Use **Re-authorize** to start over, or delete the source — nothing was archived yet. A refused first connection never causes this; the source is authorized regardless and keeps syncing.                                                                                                                             |
| Status **error** saying authorization expired                        | The refresh token died (revoked, password change, or ~90 days idle). Click **Re-authorize**.                                                                                                                                                                                                                                                                            |
