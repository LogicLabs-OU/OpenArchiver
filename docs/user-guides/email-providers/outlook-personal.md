# Outlook Personal Account

Connect your personal Microsoft account (e.g., @outlook.com, @hotmail.com, or personal @live.com accounts) to OpenArchiver to sync and archive your emails.

## Overview

The Outlook Personal provider uses OAuth2 with PKCE (Proof Key for Code Exchange) to securely connect to your personal Microsoft account. This is different from the Microsoft 365 provider, which is designed for organizational accounts with admin-level access.

**Key Features:**
- OAuth2 authorization code flow with PKCE for enhanced security
- Personal Microsoft account support (Outlook.com, Hotmail, Live.com)
- Incremental delta sync for efficient continuous synchronization
- Refresh token storage for unattended operation

## Prerequisites

1. A Microsoft Azure app registration for OAuth authentication
2. OpenArchiver backend and frontend deployed and accessible
3. A redirect URI that your users' browsers can reach

## Azure App Registration

### Step 1: Create an App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations** → **New registration**
3. Configure the registration:
   - **Name**: `OpenArchiver Outlook Personal` (or your preferred name)
   - **Supported account types**: Select **"Accounts in any organizational directory (Any Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**
   - **Redirect URI**: Select **"Web"** and enter your redirect URI (see below)
4. Click **Register**

### Step 2: Configure Redirect URI

The redirect URI should point to your OpenArchiver frontend OAuth callback page. For example:
- Production: `https://your-domain.com/dashboard/ingestions/oauth-callback`
- Local development: `http://localhost:3000/dashboard/ingestions/oauth-callback`

After registration, you can add additional redirect URIs under **Authentication** → **Platform configurations** → **Web** → **Redirect URIs**.

### Step 3: API Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission** → **Microsoft Graph** → **Delegated permissions**
3. Add the following permissions:
   - `Mail.Read` - Read user mail
   - `offline_access` - Maintain access to data you have given it access to
4. Click **Add permissions**

**Note:** These are delegated permissions that require user consent. Admin consent is NOT required for personal accounts.

### Step 4: Client Secret

1. Go to **Certificates & secrets** → **Client secrets** → **New client secret**
2. Add a description (e.g., `OpenArchiver Secret`)
3. Choose an expiration period (e.g., 24 months)
4. Click **Add**
5. **Important**: Copy the secret value immediately - it won't be shown again!

### Step 5: Note Your App Credentials

You'll need these values for OpenArchiver configuration:
- **Application (client) ID**: Found on the app overview page
- **Client secret**: The value you just copied

## OpenArchiver Configuration

Add the following environment variables to your backend `.env` file:

```bash
# Outlook Personal OAuth Configuration
OUTLOOK_PERSONAL_CLIENT_ID=your-application-client-id
OUTLOOK_PERSONAL_CLIENT_SECRET=your-client-secret-value
OUTLOOK_PERSONAL_REDIRECT_URI=https://your-domain.com/dashboard/ingestions/oauth-callback
```

**Important Notes:**
- The `OUTLOOK_PERSONAL_REDIRECT_URI` must exactly match one of the redirect URIs configured in Azure
- For local development, use `http://localhost:3000/dashboard/ingestions/oauth-callback`
- The redirect URI must be accessible by the user's browser (not just the server)

## Usage

### Adding an Outlook Personal Ingestion Source

1. Log in to OpenArchiver
2. Navigate to **Dashboard** → **Ingestions**
3. Click **Create New Ingestion Source**
4. Fill in the form:
   - **Name**: A descriptive name (e.g., "My Personal Email")
   - **Provider**: Select **Outlook Personal**
5. Click **Submit**
6. You'll be redirected to Microsoft to sign in
7. Review and grant the requested permissions
8. You'll be redirected back to OpenArchiver

After successful authentication, OpenArchiver will automatically begin syncing your emails.

### Initial Import

The initial import will:
1. Discover all mail folders in your account
2. Fetch all emails using delta queries
3. Store emails and attachments in your configured storage
4. Index emails in Meilisearch for full-text search

### Continuous Sync

After the initial import, OpenArchiver will:
- Automatically sync new emails based on the configured sync frequency (default: every minute)
- Use delta tokens to fetch only new or changed emails
- Automatically refresh OAuth tokens using the stored refresh token

## Troubleshooting

### "Outlook Personal OAuth is not configured"

This error means the required environment variables are not set. Ensure:
- `OUTLOOK_PERSONAL_CLIENT_ID` is set
- `OUTLOOK_PERSONAL_CLIENT_SECRET` is set
- `OUTLOOK_PERSONAL_REDIRECT_URI` is set
- Backend has been restarted after adding environment variables

### "Invalid state parameter - possible CSRF attack"

This can happen if:
- Browser session data was cleared during the OAuth flow
- Multiple OAuth flows were initiated simultaneously
- The OAuth flow took too long (browser cached state expired)

**Solution**: Start the authentication process again.

### "Failed to exchange authorization code for tokens"

Possible causes:
- Client secret is incorrect or expired
- Redirect URI doesn't match Azure configuration exactly
- Authorization code has expired (occurs if callback is delayed)

**Solution**: Verify your Azure app configuration and environment variables.

### "unauthorized_client: The client does not exist or is not enabled for consumers"

This usually means the Azure app registration is not configured for personal Microsoft accounts.

Ensure all of the following are true:
- `signInAudience` is set to `AzureADandPersonalMicrosoftAccount`
- Redirect URI exactly matches `OUTLOOK_PERSONAL_REDIRECT_URI`
- Microsoft Graph delegated permissions include `Mail.Read` and `offline_access`

### "The name of your application is invalid. 'Hotmail' is not allowed."

Azure blocks certain protected Microsoft brand terms in app names when enabling personal account sign-in.

**Solution**: Rename the app registration to a neutral name and retry saving the manifest.

### "Unable to change signInAudience ... Application must accept Access Token Version 2"

Azure requires v2 access tokens before allowing `AzureADandPersonalMicrosoftAccount`.

**Solution**:
1. Open the app registration **Manifest**
2. Set `api.requestedAccessTokenVersion` to `2`
3. If present in your tenant, set `accessTokenAcceptedVersion` to `2`
4. Save the manifest
5. Set `signInAudience` to `AzureADandPersonalMicrosoftAccount` and save again

### "Failed to refresh access token"

This occurs when the refresh token is invalid or expired. Possible causes:
- User revoked app permissions
- Password was changed
- Account security issues

**Solution**: Delete and recreate the ingestion source to re-authenticate.

### Redirect URI Doesn't Match

The redirect URI in your request must **exactly** match one configured in Azure:
- Protocol must match (http vs https)
- Domain must match
- Port must match (if specified)
- Path must match

## Security Considerations

1. **Client Secret Protection**: Store client secrets securely using environment variables. Never commit them to version control.

2. **PKCE**: The implementation uses PKCE (Proof Key for Code Exchange) to prevent authorization code interception attacks.

3. **Token Storage**: Refresh tokens and access tokens are encrypted at rest using your `ENCRYPTION_KEY`.

4. **Token Refresh**: Access tokens are automatically refreshed when expired using the stored refresh token.

5. **Permissions**: Only request necessary permissions (Mail.Read, offline_access). Never request more than needed.

## Limitations

- **Personal accounts only**: This provider is designed for personal Microsoft accounts. Use the Microsoft 365 provider for organizational accounts.
- **Single mailbox**: Each ingestion source connects to one personal account. To archive multiple accounts, create multiple ingestion sources.
- **Rate limits**: Microsoft Graph API has rate limits. OpenArchiver respects these limits but very large mailboxes may take time to sync initially.

## Microsoft Graph API Reference

- [Microsoft Graph API Documentation](https://docs.microsoft.com/en-us/graph/api/overview)
- [Mail API Reference](https://docs.microsoft.com/en-us/graph/api/resources/mail-api-overview)
- [Delta Query](https://docs.microsoft.com/en-us/graph/delta-query-overview)
- [OAuth 2.0 Authorization Code Flow](https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow)
