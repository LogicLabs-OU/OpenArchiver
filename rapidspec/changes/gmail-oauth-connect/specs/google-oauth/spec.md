# Spec: Google OAuth Individual Account Connection

## ADDED Requirements

### Requirement: Google OAuth Ingestion Provider
The system SHALL support a `google_oauth` ingestion provider that allows an individual Google Workspace user to connect their Gmail account via OAuth 2.0 Authorization Code flow.

#### Scenario: Successful OAuth connection
- **GIVEN** a user is logged into OpenArchiver
- **WHEN** they select "Gmail (Connect with Google)", enter a source name, and click the connect button
- **THEN** they are redirected to Google's consent screen
- **AND** after granting consent, a new ingestion source is created with status `auth_success`
- **AND** they are redirected back to `/dashboard/ingestions`

#### Scenario: OAuth flow cancelled
- **GIVEN** a user is on the Google consent screen
- **WHEN** they cancel or deny consent
- **THEN** they are redirected to `/dashboard/ingestions?error=oauth_cancelled`
- **AND** an error alert is shown
- **AND** no ingestion source is created

#### Scenario: Token refresh on sync
- **GIVEN** a `google_oauth` ingestion source exists with an expired access token
- **WHEN** a sync job runs
- **THEN** the system SHALL automatically refresh the access token using the stored refresh token
- **AND** the updated access token SHALL be encrypted and persisted

### Requirement: Google OAuth Credentials Storage
The system SHALL store `google_oauth` credentials as `{ type, email, accessToken, refreshToken }` encrypted at rest using the existing `CryptoService`.

### Requirement: CSRF Protection
The system SHALL use a random state parameter (stored in Redis with 10-minute TTL) to prevent CSRF attacks during the OAuth flow.

### Requirement: Gmail Delta Sync
The system SHALL use the Gmail History API (`users.history.list`) for incremental syncs, storing `historyId` in `syncState.google[email].historyId`.

## MODIFIED Requirements

### Requirement: IngestionProvider Type
The `IngestionProvider` union type SHALL include `'google_oauth'` alongside existing provider types. Existing `google_workspace` provider behavior is unchanged.

### Requirement: EmailProviderFactory
The `EmailProviderFactory` SHALL instantiate `GoogleOAuthConnector` when provider type is `'google_oauth'`.

## REMOVED Requirements
None — all existing requirements unchanged.
