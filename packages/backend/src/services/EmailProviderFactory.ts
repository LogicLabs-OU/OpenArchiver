import type {
	IngestionSource,
	GoogleWorkspaceCredentials,
	Microsoft365Credentials,
	GenericImapCredentials,
	PSTImportCredentials,
	EMLImportCredentials,
	MboxImportCredentials,
	EmailObject,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import { GoogleWorkspaceConnector } from './ingestion-connectors/GoogleWorkspaceConnector';
import { MicrosoftConnector } from './ingestion-connectors/MicrosoftConnector';
import { ImapConnector } from './ingestion-connectors/ImapConnector';
import { PSTConnector } from './ingestion-connectors/PSTConnector';
import { EMLConnector } from './ingestion-connectors/EMLConnector';
import { MboxConnector } from './ingestion-connectors/MboxConnector';

// Define a common interface for all connectors
export interface IEmailConnector {
	testConnection(): Promise<boolean>;
	fetchEmails(
		userEmail: string,
		syncState?: SyncState | null,
		checkDuplicate?: (messageId: string) => Promise<boolean>
	): AsyncGenerator<EmailObject | null>;
	getUpdatedSyncState(userEmail?: string): SyncState;
	listAllUsers(): AsyncGenerator<MailboxUser>;
	returnImapUserEmail?(): string;
}

export class EmailProviderFactory {
	static createConnector(source: IngestionSource): IEmailConnector {
		// Credentials are now decrypted by the IngestionService before being passed around
		const credentials = source.credentials;

		switch (source.provider) {
			case 'google_workspace':
				return new GoogleWorkspaceConnector(credentials as GoogleWorkspaceCredentials);
			case 'microsoft_365':
				return new MicrosoftConnector(credentials as Microsoft365Credentials);
			case 'generic_imap':
				return new ImapConnector(credentials as GenericImapCredentials);
			case 'pst_import':
				return new PSTConnector(credentials as PSTImportCredentials);
			case 'eml_import':
				return new EMLConnector(credentials as EMLImportCredentials);
			case 'mbox_import':
				return new MboxConnector(credentials as MboxImportCredentials);
			default:
				throw new Error(`Unsupported provider: ${source.provider}`);
		}
	}
}
