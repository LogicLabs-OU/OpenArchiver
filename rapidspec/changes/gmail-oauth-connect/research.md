# Research: gmail-oauth-connect

## Google OAuth2 for Gmail (Delegated, Individual)

### Required Scopes
- `https://www.googleapis.com/auth/gmail.readonly` — read all messages and settings
- `https://www.googleapis.com/auth/userinfo.email` — get connected account email address
- `openid` — required when using userinfo endpoint

### OAuth2 Flow (Authorization Code)
1. Backend builds URL: `https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&scope=...&response_type=code&access_type=offline&prompt=consent`
2. `access_type=offline` — required to receive a refresh token
3. `prompt=consent` — forces consent screen even if previously authorized (ensures refresh token is always returned)
4. After consent → callback receives `code` param
5. Exchange: `POST https://oauth2.googleapis.com/token` with `code`, `client_id`, `client_secret`, `redirect_uri`
6. Response: `{ access_token, refresh_token, expires_in, scope }`

### googleapis SDK (already in project)
```typescript
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  process.env.GOOGLE_OAUTH_REDIRECT_URI
);

// Build auth URL
const url = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
  prompt: 'consent',
  state: stateToken,
});

// Exchange code for tokens
const { tokens } = await oauth2Client.getToken(code);
oauth2Client.setCredentials(tokens);

// Get user email
const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
const { data } = await oauth2.userinfo.get();
// data.email = 'user@company.com'
```

### Gmail API — History-based Delta Sync
```typescript
// Initial sync: list all messages
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
const profile = await gmail.users.getProfile({ userId: 'me' });
const historyId = profile.data.historyId; // save this for delta sync

// Subsequent syncs: use history API
const history = await gmail.users.history.list({
  userId: 'me',
  startHistoryId: savedHistoryId,
  historyTypes: ['messageAdded'],
});
```

### Token Refresh Pattern
```typescript
// googleapis handles refresh automatically when setCredentials is called with refresh_token
oauth2Client.setCredentials({ refresh_token: storedRefreshToken });
// On expiry, googleapis auto-refreshes. Listen for new tokens:
oauth2Client.on('tokens', (tokens) => {
  if (tokens.access_token) {
    // save updated access_token to DB
  }
});
```

## Google Cloud Console Setup (for docs/README)
1. Go to console.cloud.google.com → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application type)
3. Add authorized redirect URI: `https://your-domain/api/oauth/google/callback`
4. Enable Gmail API under APIs & Services → Library
5. Copy Client ID and Client Secret to `.env`

## Security: State Parameter (CSRF Protection)
```typescript
// Generate state before redirect
const state = crypto.randomBytes(32).toString('hex');
// Store in session or short-lived cache (Redis/Valkey already available)
await redis.set(`oauth_state:${state}`, userId, 'EX', 600); // 10 min TTL

// Verify in callback
const stored = await redis.get(`oauth_state:${state}`);
if (!stored) throw new Error('Invalid state parameter');
```

## Google Brand Guidelines for Button
- Official button text: "Sign in with Google" or "Continue with Google"
- Must use Google logo SVG (available at developers.google.com/identity/branding-guidelines)
- Button background: white, border: #dadce0, text color: #3c4043

## Reference Implementations
- Midday.ai uses `@googleapis/gmail` with OAuth2 for individual mailbox connections
- Nextcloud Mail uses same `access_type=offline` + `prompt=consent` pattern
- Google's own sample: https://developers.google.com/gmail/api/quickstart/nodejs
