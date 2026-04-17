# Tasks: Gmail OAuth Connect

## 1. Types & Schema

### 1.1 Add GoogleOAuthCredentials type (15 min) — Checkpoint ⏸
- [x] Add `GoogleOAuthCredentials` interface to `packages/types/src/ingestion.types.ts`
- [x] Add `'google_oauth'` to `IngestionProvider` union
- [x] Add `GoogleOAuthCredentials` to `IngestionCredentials` discriminated union
**Checkpoint:** Types compile — run `pnpm build` from root

---

## 2. Backend — OAuth Routes

### 2.1 OAuth Controller (45 min) — Checkpoint ⏸
- [x] Create `packages/backend/src/api/controllers/oauth.controller.ts`
- [x] `GET /authorize` handler: build Google OAuth2 URL with `gmail.readonly` + `userinfo.email` scopes, embed `state` param (source name + anti-CSRF token)
- [x] `GET /callback` handler: exchange code for tokens, fetch user email, create ingestion source via `IngestionService.create()`
- [x] Redirect to `/dashboard/ingestions` on success, `/dashboard/ingestions?error=...` on failure
**Checkpoint:** Test authorize URL redirects to Google in browser

### 2.2 OAuth Routes (10 min)
- [x] Create `packages/backend/src/api/routes/oauth.routes.ts`
- [x] Register routes in main Express router
- [x] Add auth middleware (must be logged in to initiate OAuth)

### 2.3 Environment Config (10 min)
- [x] Add `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` to `.env.example`
- [x] Read and validate vars in backend config/env loader

---

## 3. Backend — Connector

### 3.1 GoogleOAuthConnector (60 min) — Checkpoint ⏸
- [x] Create `packages/backend/src/services/ingestion-connectors/GoogleOAuthConnector.ts`
- [x] Constructor accepts `GoogleOAuthCredentials` — initializes `google.auth.OAuth2` client with stored tokens
- [x] Implement `testConnection()` — verify token validity via `gmail.users.getProfile`
- [x] Implement `listAllUsers()` — yields single `MailboxUser` (the connected account)
- [x] Implement `fetchEmails()` — use Gmail API (`gmail.users.messages.list` + `gmail.users.messages.get`) with history ID delta sync
- [x] Implement `getUpdatedSyncState()` — returns updated `historyId`
**Checkpoint:** Unit test `testConnection()` with real credentials

### 3.2 Register in EmailProviderFactory (10 min)
- [x] Add `case 'google_oauth': return new GoogleOAuthConnector(credentials)` to `EmailProviderFactory.ts`

---

## 4. Frontend

### 4.1 Add google_oauth provider option (30 min) — Checkpoint ⏸
- [x] Add `{ value: 'google_oauth', label: 'Gmail (Connect with Google)' }` to provider list in `IngestionSourceForm.svelte`
- [x] Add `{:else if formData.provider === 'google_oauth'}` block — show "Connect with Google" button instead of manual fields
- [x] Button click: fetches `/oauth/google/authorize?name=...` (with JWT), redirects to returned URL
- [x] Add Google branding to button (Google logo SVG + "Sign in with Google" styling per Google brand guidelines)
- [x] Hide standard submit button for google_oauth provider
**Checkpoint:** Button visible in dialog, clicking redirects to Google

### 4.2 Handle OAuth return (15 min)
- [x] On `/dashboard/ingestions` page load, check for `?error=` and `?connected=` query params and show alerts
- [x] Refresh ingestion source list after OAuth return (page already loads fresh data via `+page.server.ts`)

---

## 5. Testing

### 5.1 Manual E2E test
- [ ] Set up Google OAuth credentials in `.env`
- [ ] Click "Create New" → select "Gmail (Connect with Google)" → enter name → click button
- [ ] Complete Google consent → verify source appears in list with `auth_success` status
- [ ] Trigger manual sync → verify emails are imported

### 5.2 Error cases
- [ ] Test with invalid/revoked token → confirm error state shown
- [ ] Test cancelling OAuth consent → confirm redirect to error page
- [ ] Test missing env vars → confirm clear error message in logs

---

## 6. Review (run /rapidspec:review after implementation)
- [ ] Security audit: state param CSRF protection, token encryption, no token exposure in logs
- [ ] Code review: connector follows `IEmailConnector` interface contract
- [ ] Fix any critical issues before merging
