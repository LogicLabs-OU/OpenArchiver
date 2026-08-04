# Connecting Microsoft Outlook with IMAP OAuth

Use the **Microsoft Outlook (IMAP)** provider to archive one Outlook, Hotmail, Live, or Microsoft 365 mailbox through Microsoft's device authorization flow. This connector is intended for individual mailboxes, including personal Microsoft accounts that cannot use Open Archiver's organization-wide Microsoft 365 connector.

This connection uses OAuth 2.0 and IMAP XOAUTH2. It does not require a tenant ID, client secret, or mailbox password.

## Register a Microsoft application

You need a public-client application registration. The registration supplies the Application (client) ID shown in Open Archiver.

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com/).
2. Go to **Entra ID > App registrations** and select **New registration**.
3. Enter a recognizable name, such as `Open Archiver Outlook IMAP`.
4. Under **Supported account types**, choose one of the following:
    - **Personal Microsoft accounts only** for Outlook.com, Hotmail, and Live accounts.
    - **Accounts in any organizational directory and personal Microsoft accounts** if the application must support both personal and work or school accounts.
5. Select **Register**.
6. On the application overview, copy the **Application (client) ID**. You do not need the Directory (tenant) ID.

See Microsoft's [application registration guide](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) for more detail.

## Enable device authorization

1. Open **Authentication** under the app registration's **Manage** section.
2. Under **Advanced settings**, set **Allow public client flows** to **Yes**.
3. Save the configuration.

Device authorization is a public-client flow, so do not create or enter a client secret. See Microsoft's [public-client application guidance](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications).

## Add the IMAP permission

1. Open **API permissions** under **Manage**.
2. Select **Add a permission**.
3. Select **APIs my organization uses**, find **Office 365 Exchange Online**, and choose **Delegated permissions**.
4. Add **IMAP.AccessAsUser.All**.
5. If your organization requires administrator consent, grant it before connecting the mailbox. Personal Microsoft accounts normally consent during device login.

Open Archiver requests these OAuth scopes:

- `https://outlook.office.com/IMAP.AccessAsUser.All`
- `offline_access`

The first permits delegated IMAP access. `offline_access` permits Microsoft to issue refresh tokens so Open Archiver can continue syncing after the short-lived access token expires. See Microsoft's [IMAP OAuth documentation](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth).

## Connect the mailbox

1. In Open Archiver, go to **Ingestions** and select **Create New**.
2. Enter a name and choose **Microsoft Outlook (IMAP)**.
3. Paste the **Application (client) ID** from the app registration.
4. Select **Connect Microsoft account**.
5. Open the displayed Microsoft device-login link and enter the displayed code.
6. Sign in to the mailbox you want to archive and approve access.
7. Wait until Open Archiver displays **Microsoft account connected**.
8. Submit the ingestion source.

The connector uses `outlook.office365.com`, port `993`, and TLS by default. After validating the IMAP connection, Open Archiver starts the initial import and uses the authenticated mailbox address as the IMAP username.

## Token renewal and reconnecting

Open Archiver stores the Microsoft token cache encrypted with the ingestion credentials. It uses the refresh token to obtain new access tokens silently and persists token-cache rotations.

Microsoft currently documents a 90-day default refresh-token lifetime for non-SPA scenarios, but refresh tokens renew when used and can also be revoked earlier. Password or security changes, account policy, consent removal, or an administrator or user revocation can require interactive authentication again. See Microsoft's [refresh-token documentation](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens).

If synchronization reports an expired or revoked grant:

1. Edit the existing ingestion source.
2. Select **Reconnect Microsoft account**.
3. Complete the new device-login code flow.

Open Archiver tests the new credentials and replaces the encrypted token cache on the existing ingestion source. The source and its archived email are not recreated or removed.

## Troubleshooting

- **AADSTS7000218 or a client-secret error:** Confirm **Allow public client flows** is set to **Yes**. Do not add a client secret to Open Archiver.
- **Permission or authentication failure:** Confirm the application has delegated **IMAP.AccessAsUser.All** permission and that consent was granted.
- **Personal account cannot sign in:** Confirm the app registration supports personal Microsoft accounts.
- **Device code expired:** Select **Connect Microsoft account** or **Reconnect Microsoft account** to generate a new code.
- **Sync worked previously but now fails:** Edit the source and reconnect it; Microsoft may have expired or revoked the refresh grant.
