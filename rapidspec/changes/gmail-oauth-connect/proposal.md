# Change: Gmail OAuth — "Connect with Google" for Individual Org Accounts

## Why
Users currently must paste a raw Google Service Account JSON blob and an admin email to connect Gmail — a highly technical process that fails to match the standard "click to connect" experience expected by modern apps. This adds a `google_oauth` provider that lets an individual connect their Google Workspace Gmail account via a single OAuth button.

## Code Verification
- [x] `GoogleWorkspaceCredentials` at `packages/types/src/ingestion.types.ts:53-64` — requires `serviceAccountKeyJson` + `impersonatedAdminEmail`
- [x] `GoogleWorkspaceConnector.ts:19-56` — uses service account JWT with domain-wide delegation
- [x] `IngestionSourceForm.svelte:187-186` — manual textarea for JSON key + admin email fields
- [x] `IngestionProvider` union at `ingestion.types.ts:21-27` — add `'google_oauth'` here
- [x] `EmailProviderFactory.ts` — provider switch/case needs new `google_oauth` case

## What Changes

### Before (Verified Actual Code)
```typescript
// packages/types/src/ingestion.types.ts:53-64
export interface GoogleWorkspaceCredentials extends BaseIngestionCredentials {
  type: 'google_workspace';
  serviceAccountKeyJson: string;      // paste entire JSON blob
  impersonatedAdminEmail: string;     // super-admin email
}

// packages/types/src/ingestion.types.ts:21-27
export type IngestionProvider =
  | 'google_workspace'
  | 'microsoft_365'
  | 'generic_imap'
  | 'pst_import'
  | 'eml_import'
  | 'mbox_import';
```

### After (Proposed)
```typescript
// New credential type for individual OAuth
export interface GoogleOAuthCredentials extends BaseIngestionCredentials {
  type: 'google_oauth';
  email: string;           // auto-populated from Google
  accessToken: string;     // encrypted at rest
  refreshToken: string;    // encrypted at rest
}

// Extended provider union
export type IngestionProvider =
  | 'google_workspace'
  | 'google_oauth'          // NEW
  | 'microsoft_365'
  | 'generic_imap'
  | 'pst_import'
  | 'eml_import'
  | 'mbox_import';
```

## Architecture

### OAuth Flow
```
User clicks "Connect with Google"
  → GET /api/oauth/google/authorize?name=<source-name>
  → Backend builds Google OAuth2 consent URL (gmail.readonly + userinfo.email)
  → Redirect to accounts.google.com/o/oauth2/auth
  → User logs in with org Gmail account
  → Google redirects to GET /api/oauth/google/callback?code=...&state=...
  → Backend exchanges code for { access_token, refresh_token }
  → Backend fetches user email via googleapis userinfo
  → Backend creates IngestionSource with type 'google_oauth', status 'auth_success'
  → Redirect to /dashboard/ingestions
```

### New Files
| File | Purpose |
|------|---------|
| `packages/backend/src/services/ingestion-connectors/GoogleOAuthConnector.ts` | OAuth2-based Gmail connector (single user) |
| `packages/backend/src/api/controllers/oauth.controller.ts` | Handles /authorize and /callback |
| `packages/backend/src/api/routes/oauth.routes.ts` | Route definitions |

### Modified Files
| File | Change |
|------|--------|
| `packages/types/src/ingestion.types.ts` | Add `GoogleOAuthCredentials`, extend `IngestionProvider` |
| `packages/backend/src/services/EmailProviderFactory.ts` | Add `google_oauth` case |
| `packages/frontend/src/lib/components/custom/IngestionSourceForm.svelte` | Add `google_oauth` provider option with OAuth button |
| `.env.example` | Add `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` |

## Environment Variables
```env
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback
```

## Scopes Required
- `https://www.googleapis.com/auth/gmail.readonly` — read emails
- `https://www.googleapis.com/auth/userinfo.email` — identify the account

## Security Notes
- `access_token` and `refresh_token` encrypted at rest via existing `CryptoService`
- State parameter (signed JWT or UUID) used in OAuth flow to prevent CSRF
- Token refresh handled automatically in `GoogleOAuthConnector` before each sync

## Impact
- No breaking changes — existing `google_workspace` connector untouched
- New provider type is purely additive
- Affected specs: `specs/google-oauth/spec.md`
- Affected files: `ingestion.types.ts`, `EmailProviderFactory.ts`, `IngestionSourceForm.svelte`, `.env.example`
