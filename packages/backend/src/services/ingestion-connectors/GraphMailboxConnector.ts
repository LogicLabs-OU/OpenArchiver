import type { MailboxUser, OAuthMailboxCredentials } from '@open-archiver/types';
import type { AuthProvider } from '@microsoft/microsoft-graph-client';
import type { ConnectorOptions } from '../EmailProviderFactory';
import { MicrosoftConnector } from './MicrosoftConnector';
import { OAuthTokenService } from '../oauth/OAuthTokenService';
import { normalizeEmailAddress } from '../../helpers/emailAddress';
import { logger } from '../../config/logger';

/**
 * One mailbox read over Microsoft Graph with a delegated (user) token.
 *
 * WHY THIS EXISTS. The oauth_mailbox provider fetches over IMAP, which is the general
 * answer and works for any XOAUTH2-capable server. Microsoft is the exception: on personal
 * Outlook.com mailboxes the IMAP front end accepts the token, resolves the identity, and
 * then refuses to attach a mailbox session — `NO User is authenticated but not connected` —
 * unpredictably, minutes apart, for the same credential. It reproduces from a raw socket,
 * on either sign-in realm, and under Thunderbird's own app registration, so nothing on this
 * side changes the outcome. The same account answers every Graph call first time.
 *
 * WHAT IT REUSES. Everything that makes archiving work — the delta sync, the folder walk,
 * the raw-MIME fetch through `$value`, draft and junk filtering, sync-state bookkeeping —
 * already lives in MicrosoftConnector for the tenant-wide case. Only two things differ for
 * a single delegated mailbox, and both are overridden here: where the token comes from, and
 * how the mailbox is addressed. IMAP code is not involved anywhere in this file.
 */
export class GraphMailboxConnector extends MicrosoftConnector {
	private readonly mailbox: string;

	constructor(
		credentials: OAuthMailboxCredentials,
		sourceId: string,
		options?: ConnectorOptions
	) {
		// The address the token was issued for wins over the one typed into the form: Graph
		// resolves /me from the token regardless, so this value only labels the archived
		// mail, and labelling it with an address the token does not belong to would file a
		// mailbox under the wrong owner.
		const mailbox = credentials.authorizedEmail || credentials.email;

		// Read fresh from the row on every request rather than captured at construction, for
		// the same reason the IMAP token supplier does: a delegated access token expires
		// inside a long sync, and OAuthTokenService refreshes and persists behind this call.
		const authProvider: AuthProvider = async (done) => {
			try {
				done(null, await OAuthTokenService.getValidAccessToken(sourceId));
			} catch (error) {
				logger.error(
					{ err: error, sourceId },
					'Failed to acquire delegated Microsoft Graph access token'
				);
				done(error, null);
			}
		};

		super(null, options, authProvider);
		this.mailbox = normalizeEmailAddress(mailbox);
	}

	/**
	 * A delegated token names its own mailbox and carries no permission to address another,
	 * so every mailbox-scoped request the parent builds is rewritten to `/me`. The userEmail
	 * argument is ignored deliberately — the parent passes the address it was given, and for
	 * this connector that address is only ever the signed-in one.
	 */
	protected override mailboxPath(): string {
		return '/me';
	}

	/**
	 * `/users` is a directory listing the parent uses to prove app-only access. A delegated
	 * token cannot read the directory at all, so the equivalent proof is reading the mailbox
	 * this connector exists to read.
	 */
	public override async testConnection(): Promise<boolean> {
		try {
			await this.request('/me/mailFolders').top(1).get();
			logger.info(
				{ mailbox: this.mailbox },
				'Microsoft Graph mailbox connection successful.'
			);
			return true;
		} catch (error) {
			logger.error({ err: error }, 'Failed to verify Microsoft Graph mailbox connection');
			throw error;
		}
	}

	/**
	 * One mailbox, not a directory. Mirrors what ImapConnector does for the same reason: the
	 * ingestion pipeline fans out over users, and a single-mailbox source is that fan-out
	 * with one element.
	 */
	public override async *listAllUsers(): AsyncGenerator<MailboxUser> {
		yield {
			id: '0',
			primaryEmail: this.mailbox,
			displayName: this.mailbox,
		};
	}
}
