import { google } from 'googleapis';
import type { gmail_v1, Common } from 'googleapis';
import type {
	GoogleOAuthCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector } from '../EmailProviderFactory';
import { logger } from '../../config/logger';
import { googleOAuth } from '../../config/app';
import { simpleParser, type ParsedMail, type Attachment, type AddressObject } from 'mailparser';
import { getThreadId } from './helpers/utils';

/**
 * A connector for individual Gmail accounts using OAuth 2.0 delegated access.
 * Unlike GoogleWorkspaceConnector (which uses a service account for domain-wide access),
 * this connector authenticates as a single user via their personal OAuth consent.
 */
export class GoogleOAuthConnector implements IEmailConnector {
	private credentials: GoogleOAuthCredentials;
	private oauth2Client: InstanceType<typeof google.auth.OAuth2>;
	private newHistoryId: string | undefined;
	private labelCache: Map<string, gmail_v1.Schema$Label> = new Map();

	constructor(credentials: GoogleOAuthCredentials) {
		this.credentials = credentials;

		this.oauth2Client = new google.auth.OAuth2(
			googleOAuth.clientId,
			googleOAuth.clientSecret,
			googleOAuth.redirectUri
		);

		this.oauth2Client.setCredentials({
			access_token: this.credentials.accessToken,
			refresh_token: this.credentials.refreshToken,
		});
	}

	/**
	 * Tests the connection by fetching the Gmail profile for the connected account.
	 */
	public async testConnection(): Promise<boolean> {
		try {
			const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
			await gmail.users.getProfile({ userId: 'me' });
			logger.info({ email: this.credentials.email }, 'Google OAuth connection test successful.');
			return true;
		} catch (error) {
			logger.error({ err: error, email: this.credentials.email }, 'Failed to verify Google OAuth connection');
			throw error;
		}
	}

	/**
	 * Yields the single connected user.
	 */
	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		yield {
			id: this.credentials.email,
			primaryEmail: this.credentials.email,
			displayName: this.credentials.email,
		};
	}

	/**
	 * Fetches emails for the connected account using history-based delta sync.
	 */
	public async *fetchEmails(
		userEmail: string,
		syncState?: SyncState | null,
		checkDuplicate?: (messageId: string) => Promise<boolean>
	): AsyncGenerator<EmailObject | null> {
		const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
		const startHistoryId = syncState?.google?.[userEmail]?.historyId;

		if (!startHistoryId) {
			yield* this.fetchAllMessages(gmail, userEmail, checkDuplicate);
			return;
		}

		this.newHistoryId = startHistoryId;
		let pageToken: string | undefined = undefined;

		do {
			const historyResponse: Common.GaxiosResponseWithHTTP2<gmail_v1.Schema$ListHistoryResponse> =
				await gmail.users.history.list({
					userId: 'me',
					startHistoryId: this.newHistoryId,
					pageToken,
					historyTypes: ['messageAdded'],
				});

			const histories = historyResponse.data.history;
			if (!histories || histories.length === 0) return;

			for (const historyRecord of histories) {
				if (historyRecord.messagesAdded) {
					for (const messageAdded of historyRecord.messagesAdded) {
						if (messageAdded.message?.id) {
							try {
								const messageId = messageAdded.message.id;

								if (checkDuplicate && (await checkDuplicate(messageId))) {
									logger.debug({ messageId, userEmail }, 'Skipping duplicate email (pre-check)');
									continue;
								}

								const emailObject = await this.fetchAndParseMessage(gmail, userEmail, messageId);
								if (emailObject) yield emailObject;
							} catch (error: any) {
								if (error.code === 404) {
									logger.warn({ messageId: messageAdded.message.id, userEmail }, 'Message not found, skipping.');
								} else {
									throw error;
								}
							}
						}
					}
				}
			}

			pageToken = historyResponse.data.nextPageToken ?? undefined;
			if (historyResponse.data.historyId) {
				this.newHistoryId = historyResponse.data.historyId;
			}
		} while (pageToken);
	}

	private async *fetchAllMessages(
		gmail: gmail_v1.Gmail,
		userEmail: string,
		checkDuplicate?: (messageId: string) => Promise<boolean>
	): AsyncGenerator<EmailObject | null> {
		const profileResponse = await gmail.users.getProfile({ userId: 'me' });
		if (profileResponse.data.historyId) {
			this.newHistoryId = profileResponse.data.historyId;
		}

		let pageToken: string | undefined = undefined;
		do {
			const listResponse: Common.GaxiosResponseWithHTTP2<gmail_v1.Schema$ListMessagesResponse> =
				await gmail.users.messages.list({ userId: 'me', pageToken });

			const messages = listResponse.data.messages;
			if (!messages || messages.length === 0) return;

			for (const message of messages) {
				if (message.id) {
					try {
						if (checkDuplicate && (await checkDuplicate(message.id))) {
							logger.debug({ messageId: message.id, userEmail }, 'Skipping duplicate email (pre-check)');
							continue;
						}
						const emailObject = await this.fetchAndParseMessage(gmail, userEmail, message.id);
						if (emailObject) yield emailObject;
					} catch (error: any) {
						if (error.code === 404) {
							logger.warn({ messageId: message.id, userEmail }, 'Message not found during initial import, skipping.');
						} else {
							throw error;
						}
					}
				}
			}

			pageToken = listResponse.data.nextPageToken ?? undefined;
		} while (pageToken);
	}

	private async fetchAndParseMessage(
		gmail: gmail_v1.Gmail,
		userEmail: string,
		messageId: string
	): Promise<EmailObject | null> {
		const metadataResponse = await gmail.users.messages.get({
			userId: 'me',
			id: messageId,
			format: 'METADATA',
			fields: 'labelIds',
		});
		const labels = await this.getLabelDetails(gmail, metadataResponse.data.labelIds || []);

		const msgResponse = await gmail.users.messages.get({
			userId: 'me',
			id: messageId,
			format: 'RAW',
		});

		if (!msgResponse.data.raw) return null;

		const rawEmail = Buffer.from(msgResponse.data.raw, 'base64url');
		const parsedEmail: ParsedMail = await simpleParser(rawEmail);

		const mapAddresses = (addresses: AddressObject | AddressObject[] | undefined): EmailAddress[] => {
			if (!addresses) return [];
			const arr = Array.isArray(addresses) ? addresses : [addresses];
			return arr.flatMap((a) => a.value.map((v) => ({ name: v.name, address: v.address || '' })));
		};

		const attachments = parsedEmail.attachments.map((a: Attachment) => ({
			filename: a.filename || 'untitled',
			contentType: a.contentType,
			size: a.size,
			content: a.content as Buffer,
		}));

		return {
			id: msgResponse.data.id!,
			threadId: getThreadId(parsedEmail.headers),
			userEmail,
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
			path: labels.path,
			tags: labels.tags,
		};
	}

	public getUpdatedSyncState(userEmail: string): SyncState {
		if (!this.newHistoryId) return {};
		return {
			google: {
				[userEmail]: { historyId: this.newHistoryId },
			},
		};
	}

	private async getLabelDetails(
		gmail: gmail_v1.Gmail,
		labelIds: string[]
	): Promise<{ path: string; tags: string[] }> {
		const tags: string[] = [];
		let path = '';

		for (const labelId of labelIds) {
			let label = this.labelCache.get(labelId);
			if (!label) {
				const res = await gmail.users.labels.get({ userId: 'me', id: labelId });
				label = res.data;
				this.labelCache.set(labelId, label);
			}
			if (label.name) {
				tags.push(label.name);
				if (label.type === 'user') {
					path = path ? `${path}/${label.name}` : label.name;
				}
			}
		}

		return { path, tags };
	}
}
