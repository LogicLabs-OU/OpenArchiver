import type {
	IngestionSource,
	GoogleWorkspaceCredentials,
	Microsoft365Credentials,
	GenericImapCredentials,
	PSTImportCredentials,
	EMLImportCredentials,
	MboxImportCredentials,
	OAuthMailboxCredentials,
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
import { GraphMailboxConnector } from './ingestion-connectors/GraphMailboxConnector';
import { OAuthTokenService } from './oauth/OAuthTokenService';

/**
 * Options passed to connectors to control ingestion behaviour.
 * Currently used to skip extracting full attachment binary content
 * in preserve-original-file (GoBD) mode, where attachments are never
 * stored separately and the raw EML is kept as-is.
 */
export interface ConnectorOptions {
	/** When true, connectors omit attachment binary content from the
	 *  yielded EmailObject to avoid unnecessary memory allocation. */
	preserveOriginalFile: boolean;
}

// Define a common interface for all connectors
export interface IEmailConnector {
	testConnection(): Promise<boolean>;
	fetchEmails(
		userEmail: string,
		syncState?: SyncState | null,
		/**
		 * Pre-download duplicate check. `messageId` is the connector's own id for the
		 * message; `internetMessageId` is the RFC 5322 Message-ID when the listing already
		 * carries it (Microsoft Graph does). The second key is what keeps the check working
		 * when the provider's id for an already-archived message has changed — Graph ids do
		 * that on folder moves and did it wholesale on the switch to immutable ids.
		 */
		checkDuplicate?: (messageId: string, internetMessageId?: string) => Promise<boolean>
	): AsyncGenerator<EmailObject | null>;
	getUpdatedSyncState(userEmail?: string): SyncState;
	listAllUsers(): AsyncGenerator<MailboxUser>;
	returnImapUserEmail?(): string;
	/**
	 * Messages the connector retried, gave up on, and skipped so the rest of the mailbox could
	 * still be archived. Read by the process-mailbox job after the fetch generator finishes, so
	 * the skipped messages are reported instead of disappearing without a trace.
	 */
	getFetchFailures?(): { count: number; samples: string[] };
}

export class EmailProviderFactory {
	static createConnector(source: IngestionSource): IEmailConnector {
		// Credentials are now decrypted by the IngestionService before being passed around
		const credentials = source.credentials;
		const options: ConnectorOptions = {
			preserveOriginalFile: source.preserveOriginalFile ?? false,
		};

		switch (source.provider) {
			case 'google_workspace':
				return new GoogleWorkspaceConnector(
					credentials as GoogleWorkspaceCredentials,
					options
				);
			case 'microsoft_365':
				return new MicrosoftConnector(credentials as Microsoft365Credentials, options);
			case 'generic_imap':
				return new ImapConnector(credentials as GenericImapCredentials, options);
			case 'pst_import':
				return new PSTConnector(credentials as PSTImportCredentials, options);
			case 'eml_import':
				return new EMLConnector(credentials as EMLImportCredentials, options);
			case 'mbox_import':
				return new MboxConnector(credentials as MboxImportCredentials, options);
			case 'oauth_mailbox': {
				const oauthCredentials = credentials as OAuthMailboxCredentials;

				// Graph is opt-in per source and Microsoft-only. Absent means IMAP, so every
				// source created before Graph existed keeps the transport it was built with.
				if (oauthCredentials.transport === 'graph') {
					return new GraphMailboxConnector(oauthCredentials, source.id, options);
				}

				// Same transport as generic_imap; only authentication differs. The token
				// supplier reads the row fresh on every connection attempt so reconnects
				// deep into a sync see tokens refreshed elsewhere, and refreshing inside
				// the supplier keeps token lifetimes the connector's problem to not have.
				//
				// The XOAUTH2 username is the address the token was ISSUED for whenever the
				// provider disclosed it, not the one typed into the form. The server matches
				// the two and refuses a mismatch with wording that names neither, so trusting
				// the token's own claim is what keeps a stray sign-in from looking like a
				// broken mailbox.
				const oauth = oauthCredentials;
				return new ImapConnector(
					{
						type: 'generic_imap',
						host: oauth.imapHost,
						port: oauth.imapPort ?? 993,
						secure: true,
						allowInsecureCert: false,
						username: oauth.authorizedEmail || oauth.email,
					},
					options,
					() => OAuthTokenService.getValidAccessToken(source.id)
				);
			}
			default:
				throw new Error(`Unsupported provider: ${source.provider}`);
		}
	}
}
