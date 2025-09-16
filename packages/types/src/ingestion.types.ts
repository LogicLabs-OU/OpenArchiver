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
	| 'mbox_import';

export type IngestionStatus =
	| 'active'
	| 'paused'
	| 'error'
	| 'pending_auth'
	| 'syncing'
	| 'importing'
	| 'auth_success'
	| 'imported';

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
	uploadedFileName: string;
	uploadedFilePath: string;
}

export interface EMLImportCredentials extends BaseIngestionCredentials {
	type: 'eml_import';
	uploadedFileName: string;
	uploadedFilePath: string;
}

export interface MboxImportCredentials extends BaseIngestionCredentials {
	type: 'mbox_import';
	uploadedFileName: string;
	uploadedFilePath: string;
}

// Discriminated union for all possible credential types
export type IngestionCredentials =
	| GenericImapCredentials
	| GoogleWorkspaceCredentials
	| Microsoft365Credentials
	| PSTImportCredentials
	| EMLImportCredentials
	| MboxImportCredentials;

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
