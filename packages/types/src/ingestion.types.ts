export type SyncState = {
	google?: {
		[userEmail: string]: {
			historyId: string;
		};
	};
	microsoft?: {
		[userEmail: string]: {
			deltaTokens: { [folderId: string]: string };
		};
	};
	imap?: {
		[mailboxPath: string]: {
			maxUid: number;
		};
	};
	lastSyncTimestamp?: string;
	statusMessage?: string;
	/**
	 * ISO timestamp of when the one-shot provider-id backfill (regular Graph ids translated
	 * to immutable ids) completed for this source. Absent means not yet run; the sync cycle
	 * enqueues the job until it is set. Microsoft 365 sources only.
	 */
	providerIdBackfillCompletedAt?: string;
};

export type IngestionProvider =
	| 'google_workspace'
	| 'microsoft_365'
	| 'generic_imap'
	| 'pst_import'
	| 'eml_import'
	| 'mbox_import'
	| 'smtp_journaling'
	| 'oauth_mailbox';

export type IngestionStatus =
	| 'active'
	| 'paused'
	| 'error'
	| 'pending_auth'
	| 'syncing'
	| 'importing'
	| 'auth_success'
	| 'imported'
	| 'partially_active'; // For sources with merged children where some are active and others are not

export interface BaseIngestionCredentials {
	type: IngestionProvider;
}

export interface GenericImapCredentials extends BaseIngestionCredentials {
	type: 'generic_imap';
	host: string;
	port: number;
	secure: boolean;
	allowInsecureCert: boolean;
	username: string;
	password?: string;
}

export interface GoogleWorkspaceCredentials extends BaseIngestionCredentials {
	type: 'google_workspace';
	/**
	 * The full JSON content of the Google Service Account key.
	 * This should be a stringified JSON object.
	 */
	serviceAccountKeyJson: string;
	/**
	 * The email of the super-admin user to impersonate for domain-wide operations.
	 */
	impersonatedAdminEmail: string;
}

export interface Microsoft365Credentials extends BaseIngestionCredentials {
	type: 'microsoft_365';
	clientId: string;
	clientSecret: string;
	tenantId: string;
}

export interface PSTImportCredentials extends BaseIngestionCredentials {
	type: 'pst_import';
	uploadedFileName?: string;
	uploadedFilePath?: string;
	localFilePath?: string;
}

export interface EMLImportCredentials extends BaseIngestionCredentials {
	type: 'eml_import';
	uploadedFileName?: string;
	uploadedFilePath?: string;
	localFilePath?: string;
}

export interface MboxImportCredentials extends BaseIngestionCredentials {
	type: 'mbox_import';
	uploadedFileName?: string;
	uploadedFilePath?: string;
	localFilePath?: string;
}

export interface SmtpJournalingCredentials extends BaseIngestionCredentials {
	type: 'smtp_journaling';
	/** The ID of the journaling_sources row that owns this ingestion source */
	journalingSourceId: string;
}

export type OAuthMailboxPreset = 'outlook' | 'microsoft_work' | 'custom';
export type OAuthMailboxFlow = 'auth_code' | 'device_code';

/**
 * How an authorized mailbox is actually read.
 *
 * 'imap' is the general case and the default: any server that speaks IMAP with SASL
 * XOAUTH2. 'graph' exists because Microsoft refuses IMAP sessions on personal Outlook.com
 * mailboxes at random — the token is accepted and the mailbox is then not attached — while
 * the same account answers every Graph call first time. Graph is Microsoft-only by nature,
 * so it is selected by the Microsoft presets and never by Custom.
 */
export type OAuthMailboxTransport = 'imap' | 'graph';

/**
 * A single mailbox whose authentication is OAuth 2.0, read over IMAP (SASL XOAUTH2) or
 * over Microsoft Graph. Built for personal Outlook.com accounts now that Microsoft has
 * retired basic authentication; the `custom` preset covers any XOAUTH2-capable server.
 *
 * `tokens`, `pendingAuth` and `authorizedEmail` are SERVER-MANAGED: written only by the
 * OAuth service after an authorization or refresh, stripped from any client-supplied
 * provider config, and never included in API responses (SafeIngestionSource omits
 * credentials wholesale).
 */
export interface OAuthMailboxCredentials extends BaseIngestionCredentials {
	type: 'oauth_mailbox';
	preset: OAuthMailboxPreset;
	/** Which authorization flow this source uses by default. */
	flow: OAuthMailboxFlow;
	/** The mailbox the admin intends to archive, as typed into the form. */
	email: string;
	/**
	 * Server-managed. The address the granted token was actually issued for, read from the
	 * id_token when the provider returns one. Preferred over `email` as the XOAUTH2
	 * username, because the server matches the token's own identity against the mailbox it
	 * is asked to open — a sign-in with a different account than the one typed is refused
	 * with a message that names neither.
	 */
	authorizedEmail?: string;
	clientId: string;
	/** Optional: public clients (PKCE / device code) need none. Blank on edit = keep existing. */
	clientSecret?: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	/** Required when `flow` is 'device_code'. */
	deviceAuthorizationEndpoint?: string;
	/** Space-separated OAuth scopes. Must match the transport: IMAP and Graph want different ones. */
	scopes: string;
	/** Defaults to 'imap' when absent, so sources created before Graph existed keep working. */
	transport?: OAuthMailboxTransport;
	/** Unused when the transport is 'graph'. */
	imapHost: string;
	/** Defaults to 993. The connection is always TLS. Unused when the transport is 'graph'. */
	imapPort: number;
	/** Server-managed. Never accepted from the client. */
	tokens?: {
		accessToken: string;
		refreshToken?: string;
		/** ISO timestamp after which the access token must be refreshed. */
		expiresAt: string;
	};
	/** Server-managed. Present only while an authorization is in flight. */
	pendingAuth?: {
		flow: OAuthMailboxFlow;
		/** PKCE verifier (auth_code flow). */
		codeVerifier?: string;
		/** Nonce bound into the signed OAuth state (auth_code flow). */
		stateNonce?: string;
		/** Device-code flow secret. Never sent to the client. */
		deviceCode?: string;
		userCode?: string;
		verificationUri?: string;
		verificationUriComplete?: string;
		/** Polling interval in seconds, from the device authorization response. */
		interval?: number;
		/** ISO timestamp after which this authorization attempt is dead. */
		expiresAt: string;
	};
}

// Discriminated union for all possible credential types
export type IngestionCredentials =
	| GenericImapCredentials
	| GoogleWorkspaceCredentials
	| Microsoft365Credentials
	| PSTImportCredentials
	| EMLImportCredentials
	| MboxImportCredentials
	| SmtpJournalingCredentials
	| OAuthMailboxCredentials;

export interface IngestionSource {
	id: string;
	name: string;
	provider: IngestionProvider;
	status: IngestionStatus;
	createdAt: Date;
	updatedAt: Date;
	credentials: IngestionCredentials;
	lastSyncStartedAt?: Date | null;
	lastSyncFinishedAt?: Date | null;
	lastSyncStatusMessage?: string | null;
	syncState?: SyncState | null;
	/** When true, the raw EML file is stored without any modification (no attachment
	 * stripping). Required for GoBD / SEC 17a-4 compliance. Defaults to false. */
	preserveOriginalFile: boolean;
	/** The ID of the root ingestion source this child is merged into.
	 *  Null or undefined when this source is a standalone root. */
	mergedIntoId?: string | null;
}

/**
 * Represents an ingestion source with sensitive credential information removed.
 * This type is safe to use in client-side applications or API responses
 * where exposing credentials would be a security risk.
 */
export type SafeIngestionSource = Omit<IngestionSource, 'credentials'>;

export interface CreateIngestionSourceDto {
	name: string;
	provider: IngestionProvider;
	providerConfig: Record<string, any>;
	/** Store the unmodified raw EML for GoBD compliance. Defaults to false. */
	preserveOriginalFile?: boolean;
	/** Merge this new source into an existing root source's group. */
	mergedIntoId?: string;
}

export interface UpdateIngestionSourceDto {
	name?: string;
	provider?: IngestionProvider;
	status?: IngestionStatus;
	providerConfig?: Record<string, any>;
	lastSyncStartedAt?: Date;
	lastSyncFinishedAt?: Date;
	lastSyncStatusMessage?: string;
	syncState?: SyncState;
	/** Set or clear the merge parent. Use null to unmerge. */
	mergedIntoId?: string | null;
}

/**
 * What the authorize endpoint hands back for an oauth_mailbox source. The auth_code
 * variant carries the URL to send the browser to; the device_code variant carries only
 * the user-facing fields of RFC 8628 — the device_code itself stays server-side.
 */
export type OAuthAuthorizeResponse =
	| { flow: 'auth_code'; authorizationUrl: string }
	| {
			flow: 'device_code';
			userCode: string;
			verificationUri: string;
			verificationUriComplete?: string;
			/** Seconds until the device code expires. */
			expiresIn: number;
			/** Seconds the client should wait between polls. */
			interval: number;
	  };

/** One step of the frontend-driven device-code poll loop. */
export interface OAuthPollResponse {
	/** True while the user has not yet completed the sign-in. */
	pending: boolean;
	status: IngestionStatus;
	/** Present when the provider asked to slow down; the new interval in seconds. */
	interval?: number;
	/** Terminal failure (expired code, consent denied, exchange error). */
	error?: string;
	/**
	 * The authorization succeeded, but the first connection to the mailbox did not. Not a
	 * failure: the source is authorized and syncing retries, so this is shown alongside the
	 * success rather than instead of it.
	 */
	warning?: string;
}

/**
 * Rich, read-only statistics for a single ingestion source, aggregated across its
 * whole merge group. Backs the per-source statistics page. All counts/bytes are
 * group-scoped; `emailBytes` is physical storage (deduplicated by file hash).
 */
export interface IngestionStats {
	sourceId: string;
	name: string;
	provider: IngestionProvider;
	status: IngestionStatus;
	/** Total archived emails (all rows, including shared-file references). */
	totalEmails: number;
	/** Distinct mailbox owners (archived_emails.userEmail). */
	mailboxCount: number;
	/** Distinct email threads. */
	threadCount: number;
	/** Physical email storage in bytes, deduplicated by storage hash. */
	emailBytes: number;
	/** Deduplicated attachment storage in bytes. */
	attachmentBytes: number;
	/** emailBytes + attachmentBytes. */
	totalBytes: number;
	/** Distinct stored attachment files. */
	attachmentCount: number;
	/** Emails that have at least one attachment. */
	emailsWithAttachments: number;
	/** Documents present in the search index (Meilisearch) for this group. */
	indexedCount: number;
	/** Emails flagged as journaled. */
	journaledCount: number;
	/** Emails under a legal hold (enterprise feature — displayed only in enterprise mode). */
	legalHoldCount: number;
	/** Earliest / latest email sent date (ISO string) or null when empty. */
	firstEmailAt: string | null;
	lastEmailAt: string | null;
	lastSyncStartedAt: Date | string | null;
	lastSyncFinishedAt: Date | string | null;
	lastSyncStatusMessage: string | null;
	/** Per-mailbox breakdown, ordered by email count desc. */
	mailboxes: { userEmail: string; emailCount: number; bytes: number }[];
	/** Merge-group child sources (empty when this is a standalone source). */
	children: { id: string; name: string; provider: IngestionProvider; status: IngestionStatus }[];
	/** Emails archived per day over the last 30 days. */
	recentActivity: { date: string; count: number }[];
}

export interface IContinuousSyncJob {
	ingestionSourceId: string;
}

export interface IInitialImportJob {
	ingestionSourceId: string;
}

export interface IProcessMailboxJob {
	ingestionSourceId: string;
	userEmail: string;
	/** ID of the SyncSession tracking this sync cycle's progress */
	sessionId: string;
}

export interface IPstProcessingJob {
	ingestionSourceId: string;
	filePath: string;
	originalFilename: string;
}

export type MailboxUser = {
	id: string;
	primaryEmail: string;
	displayName: string;
};

export type ProcessMailboxError = {
	error: boolean;
	message: string;
};

/**
 * Returned by a process-mailbox job for a directory entry that has no mailbox to archive —
 * an Entra ID guest, or a member without an Exchange licence.
 *
 * Distinct from ProcessMailboxError because it is not a failure of the cycle: nothing is
 * wrong, there is simply nothing to fetch. Counting it as an error left the source in
 * `error` after every cycle, which the scheduler retries every tick forever (#351). The
 * mailbox counts as completed and the reason is reported alongside the cycle's result.
 */
export type ProcessMailboxSkip = {
	skipped: true;
	message: string;
};

/**
 * Returned by IngestionService.processEmail when archiving a single email fails.
 * Distinguishes genuine per-message errors from `null`, which strictly means the
 * email was deduplicated / intentionally skipped.
 */
export type ProcessEmailError = {
	error: true;
	message: string;
};
