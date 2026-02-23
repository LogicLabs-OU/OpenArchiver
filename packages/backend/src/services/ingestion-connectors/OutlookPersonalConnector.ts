import 'cross-fetch/polyfill';
import type {
	OutlookPersonalCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector } from '../EmailProviderFactory';
import { logger } from '../../config/logger';
import { simpleParser, ParsedMail, Attachment, AddressObject } from 'mailparser';
import { ConfidentialClientApplication, Configuration, LogLevel } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';
import type { User, MailFolder } from 'microsoft-graph';
import type { AuthProvider } from '@microsoft/microsoft-graph-client';
import { config } from '../../config';

/**
 * A connector for Outlook Personal that uses the Microsoft Graph API with delegated auth (OAuth2 + PKCE)
 * to access a personal Microsoft account mailbox.
 */
export class OutlookPersonalConnector implements IEmailConnector {
	private credentials: OutlookPersonalCredentials;
	private graphClient: Client;
	private accessToken: string | null = null;
	// Store delta tokens for each folder during a sync operation.
	private newDeltaTokens: { [folderId: string]: string };

	constructor(credentials: OutlookPersonalCredentials) {
		this.credentials = credentials;
		this.newDeltaTokens = {}; // Initialize as an empty object

		// Use cached access token if still valid
		if (
			this.credentials.accessToken &&
			this.credentials.expiresAt &&
			this.credentials.expiresAt > Date.now()
		) {
			this.accessToken = this.credentials.accessToken;
		}

		const authProvider: AuthProvider = async (done) => {
			try {
				// If we have a valid access token, use it
				if (this.accessToken) {
					done(null, this.accessToken);
					return;
				}

				// Otherwise, refresh the token
				const newAccessToken = await this.refreshAccessToken();
				this.accessToken = newAccessToken;
				done(null, newAccessToken);
			} catch (error) {
				logger.error({ err: error }, 'Failed to acquire Microsoft Graph access token');
				done(error, null);
			}
		};

		this.graphClient = Client.init({ authProvider });
	}

	/**
	 * Refreshes the access token using the refresh token.
	 */
	private async refreshAccessToken(): Promise<string> {
		const clientId = config.app.outlookPersonal.clientId;
		const clientSecret = config.app.outlookPersonal.clientSecret;

		if (!clientId || !clientSecret) {
			throw new Error('Outlook Personal OAuth credentials not configured');
		}

		const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
		const params = new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: this.credentials.refreshToken,
			grant_type: 'refresh_token',
			scope: this.credentials.scopes.join(' '),
		});

		const response = await fetch(tokenEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: params.toString(),
		});

		if (!response.ok) {
			const errorData = await response.text();
			logger.error({ errorData }, 'Failed to refresh access token');
			throw new Error('Failed to refresh access token');
		}

		const data = await response.json();
		
		// Update credentials with new tokens
		this.credentials.accessToken = data.access_token;
		this.credentials.expiresAt = Date.now() + data.expires_in * 1000;
		
		// Update refresh token if a new one was issued
		if (data.refresh_token) {
			this.credentials.refreshToken = data.refresh_token;
		}

		return data.access_token;
	}

	/**
	 * Tests the connection by attempting to get the current user's profile.
	 */
	public async testConnection(): Promise<boolean> {
		try {
			await this.graphClient.api('/me').get();
			logger.info('Outlook Personal connection test successful.');
			return true;
		} catch (error) {
			logger.error({ err: error }, 'Failed to verify Outlook Personal connection');
			throw error;
		}
	}

	/**
	 * Lists the authenticated user (returns a single-item generator since this is a personal account).
	 */
	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		try {
			const user = await this.graphClient
				.api('/me')
				.select('id,userPrincipalName,displayName')
				.get();

			if (user.id && user.userPrincipalName) {
				yield {
					id: user.id,
					primaryEmail: user.userPrincipalName,
					// Fall back to the UPN when displayName is absent so we never
					// silently skip the account.
					displayName: user.displayName || user.userPrincipalName,
				};
			}
		} catch (error) {
			logger.error({ err: error }, 'Failed to get user profile from Outlook Personal');
			throw error;
		}
	}

	/**
	 * Fetches emails for the authenticated user by iterating through all mail folders and
	 * performing a delta query on each.
	 * @param userEmail The user's email (should match the authenticated account).
	 * @param syncState Optional state containing the deltaTokens for each folder.
	 * @returns An async generator that yields each raw email object.
	 */
	public async *fetchEmails(
		userEmail: string,
		syncState?: SyncState | null
	): AsyncGenerator<EmailObject> {
		this.newDeltaTokens = syncState?.outlookPersonal?.[userEmail]?.deltaTokens || {};

		try {
			const folders = this.listAllFolders();
			for await (const folder of folders) {
				if (folder.id && folder.path) {
					logger.info(
						{ userEmail, folderId: folder.id, folderName: folder.displayName },
						'Syncing folder'
					);
					yield* this.syncFolder(
						folder.id,
						folder.path,
						this.newDeltaTokens[folder.id]
					);
				}
			}
		} catch (error) {
			logger.error({ err: error, userEmail }, 'Failed to fetch emails from Outlook Personal');
			throw error;
		}
	}

	/**
	 * Lists all mail folders for the authenticated user.
	 * @returns An async generator that yields each mail folder.
	 */
	private async *listAllFolders(
		parentFolderId?: string,
		currentPath = ''
	): AsyncGenerator<MailFolder & { path: string }> {
		const requestUrl = parentFolderId
			? `/me/mailFolders/${parentFolderId}/childFolders`
			: `/me/mailFolders`;

		try {
			let response = await this.graphClient.api(requestUrl).get();

			while (response) {
				for (const folder of response.value as MailFolder[]) {
					const newPath = currentPath
						? `${currentPath}/${folder.displayName || ''}`
						: folder.displayName || '';
					yield { ...folder, path: newPath || '' };

					if (folder.childFolderCount && folder.childFolderCount > 0) {
						yield* this.listAllFolders(folder.id, newPath);
					}
				}

				if (response['@odata.nextLink']) {
					response = await this.graphClient.api(response['@odata.nextLink']).get();
				} else {
					break;
				}
			}
		} catch (error) {
			logger.error({ err: error }, 'Failed to list mail folders');
			throw error;
		}
	}

	/**
	 * Performs a delta sync on a single mail folder.
	 * @param folderId The ID of the folder to sync.
	 * @param path The folder path for logging.
	 * @param deltaToken The existing delta token for this folder, if any.
	 * @returns An async generator that yields email objects.
	 */
	private async *syncFolder(
		folderId: string,
		path: string,
		deltaToken?: string
	): AsyncGenerator<EmailObject> {
		let requestUrl: string | undefined;

		if (deltaToken) {
			// Continuous sync
			requestUrl = deltaToken;
		} else {
			// Initial sync
			requestUrl = `/me/mailFolders/${folderId}/messages/delta`;
		}

		while (requestUrl) {
			try {
				const response = await this.graphClient
					.api(requestUrl)
					.select('id,conversationId')
					.get();

				for (const message of response.value) {
					if (message.id && !message['@removed']) {
						const rawEmail = await this.getRawEmail(message.id);
						if (rawEmail) {
							const emailObject = await this.parseEmail(
								rawEmail,
								message.id,
								this.credentials.accountEmail,
								path
							);
							emailObject.threadId = message.conversationId; // Add conversationId as threadId
							yield emailObject;
						}
					}
				}

				if (response['@odata.deltaLink']) {
					this.newDeltaTokens[folderId] = response['@odata.deltaLink'];
				}

				requestUrl = response['@odata.nextLink'];
			} catch (error) {
				logger.error({ err: error, folderId }, 'Failed to sync mail folder');
				// Continue to the next folder if one fails
				return;
			}
		}
	}

	private async getRawEmail(messageId: string): Promise<Buffer | null> {
		try {
			const response = await this.graphClient
				.api(`/me/messages/${messageId}/$value`)
				.getStream();
			const chunks: any[] = [];
			for await (const chunk of response) {
				chunks.push(chunk);
			}
			return Buffer.concat(chunks);
		} catch (error) {
			logger.error(
				{ err: error, messageId },
				'Failed to fetch raw email content.'
			);
			return null;
		}
	}

	private async parseEmail(
		rawEmail: Buffer,
		messageId: string,
		userEmail: string,
		path: string
	): Promise<EmailObject> {
		const parsedEmail: ParsedMail = await simpleParser(rawEmail);
		const attachments = parsedEmail.attachments.map((attachment: Attachment) => ({
			filename: attachment.filename || 'untitled',
			contentType: attachment.contentType,
			size: attachment.size,
			content: attachment.content as Buffer,
		}));
		const mapAddresses = (
			addresses: AddressObject | AddressObject[] | undefined
		): EmailAddress[] => {
			if (!addresses) return [];
			const addressArray = Array.isArray(addresses) ? addresses : [addresses];
			return addressArray.flatMap((a) =>
				a.value.map((v) => ({ name: v.name, address: v.address || '' }))
			);
		};

		return {
			id: messageId,
			userEmail: userEmail,
			eml: rawEmail,
			from: mapAddresses(parsedEmail.from),
			to: mapAddresses(parsedEmail.to),
			cc: mapAddresses(parsedEmail.cc),
			bcc: mapAddresses(parsedEmail.bcc),
			subject: parsedEmail.subject || '',
			body: parsedEmail.text || '',
			html: parsedEmail.html || '',
			headers: parsedEmail.headers,
			attachments,
			receivedAt: parsedEmail.date || new Date(),
			path,
		};
	}

	public getUpdatedSyncState(userEmail?: string): SyncState {
		if (!userEmail || Object.keys(this.newDeltaTokens).length === 0) {
			return {};
		}
		return {
			outlookPersonal: {
				[userEmail]: {
					deltaTokens: this.newDeltaTokens,
				},
			},
		};
	}

	/**
	 * Returns the updated credentials with new tokens after sync.
	 * This should be called after a sync to persist updated tokens.
	 */
	public getUpdatedCredentials(): OutlookPersonalCredentials {
		return this.credentials;
	}
}
