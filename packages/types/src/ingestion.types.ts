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
};

export type IngestionProvider =
	| 'google_workspace'
	| 'microsoft_365'
	| 'generic_imap'
	| 'pst_import'
	| 'eml_import'
	| 'mbox_import'
	| 'smtp_journaling';

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

// Discriminated union for all possible credential types
export type IngestionCredentials =
	| GenericImapCredentials
	| GoogleWorkspaceCredentials
	| Microsoft365Credentials
	| PSTImportCredentials
	| EMLImportCredentials
	| MboxImportCredentials
	| SmtpJournalingCredentials;

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
