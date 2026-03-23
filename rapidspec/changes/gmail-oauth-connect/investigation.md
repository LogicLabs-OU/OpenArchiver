# Investigation: gmail-oauth-connect

## Current State Analysis

### Credential Flow (verified)
1. User opens "Create Ingestion Source" dialog (`+page.svelte:28-31`)
2. Selects `google_workspace` provider
3. `IngestionSourceForm.svelte` shows two fields:
   - Textarea for `serviceAccountKeyJson` (raw JSON blob from Google Cloud Console)
   - Input for `impersonatedAdminEmail` (a super-admin's email)
4. On submit → `POST /api/ingestion-sources` → `IngestionService.create()` validates via `testConnection()`

### GoogleWorkspaceConnector (app/domain-wide, NOT individual)
- `GoogleWorkspaceConnector.ts:19` — class targets the entire Google Workspace domain
- `getAuthClient()` at `:48` — creates JWT client that impersonates ANY user in the domain
- `listAllUsers()` at `:~80` — calls Google Admin Directory API to enumerate all domain users
- This is intentionally designed for organization-wide archiving, not individual accounts

### Why a new provider type (not modifying existing)
- `google_workspace` is a different use case (entire org via service account)
- `google_oauth` is individual account via personal consent
- Keeping them separate preserves existing customers' configurations
- `EmailProviderFactory` uses a discriminated union — adding a new case is clean

### IngestionCredentials storage
- Credentials stored as encrypted JSONB in PostgreSQL via `CryptoService`
- `accessToken` + `refreshToken` will be encrypted like other credential fields
- No schema migration needed — existing JSONB column accommodates new shape

### SyncState compatibility
- `SyncState.google` is keyed by `userEmail` — `GoogleOAuthConnector` uses same shape
- `historyId` delta sync pattern works identically for OAuth individual accounts
- No `SyncState` changes needed

## Existing Patterns to Follow
- `ImapConnector.ts` — similar single-user connector pattern, good reference
- `IngestionService.testConnection()` — called on create, handles `auth_success` status
- `CryptoService.encrypt/decrypt` — wrap tokens before storing
