import { google } from 'googleapis';
import type { admin_directory_v1, gmail_v1, Common } from 'googleapis';
import type {
	GoogleWorkspaceCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector } from '../EmailProviderFactory';
import { logger } from '../../config/logger';
import { simpleParser, ParsedMail, Attachment, AddressObject, Headers } from 'mailparser';
import { getThreadId } from './helpers/utils';

/**
 * A connector for Google Workspace that uses a service account with domain-wide delegation
 * to access user data on behalf of users in the domain.
 */
export class GoogleWorkspaceConnector implements IEmailConnector {
	private credentials: GoogleWorkspaceCredentials;
	private serviceAccountCreds: { client_email: string; private_key: string };
	private newHistoryId: string | undefined;

	constructor(credentials: GoogleWorkspaceCredentials) {
		this.credentials = credentials;
		try {
			// Pre-parse the JSON key to catch errors early.
			const parsedKey = JSON.parse(this.credentials.serviceAccountKeyJson);
			if (!parsedKey.client_email || !parsedKey.private_key) {
				throw new Error('Service account key JSON is missing required fields.');
			}
			this.serviceAccountCreds = {
				client_email: parsedKey.client_email,
				private_key: parsedKey.private_key,
			};
		} catch (error) {
			logger.error({ err: error }, 'Failed to parse Google Service Account JSON');
			throw new Error('Invalid Google Service Account JSON key.');
		}
	}

	/**
	 * Creates an authenticated JWT client capable of impersonating a user.
	 * @param subject The email address of the user to impersonate.
	 * @param scopes The OAuth scopes required for the API calls.
	 * @returns An authenticated JWT client.
	 */
	private getAuthClient(subject: string, scopes: string[]) {
		const jwtClient = new google.auth.JWT({
			email: this.serviceAccountCreds.client_email,
			key: this.serviceAccountCreds.private_key,
			scopes,
			subject,
		});
		return jwtClient;
	}

	/**
	 * Tests the connection and authentication by attempting to list the first user
	 * from the directory, impersonating the admin user.
	 */
	public async testConnection(): Promise<boolean> {
		try {
			const authClient = this.getAuthClient(this.credentials.impersonatedAdminEmail, [
				'https://www.googleapis.com/auth/admin.directory.user.readonly',
			]);

			const admin = google.admin({
				version: 'directory_v1',
				auth: authClient,
			});

			// Perform a simple, low-impact read operation to verify credentials.
			await admin.users.list({
				customer: 'my_customer',
				maxResults: 1,
				orderBy: 'email',
			});

			logger.info('Google Workspace connection test successful.');
			return true;
		} catch (error) {
			logger.error({ err: error }, 'Failed to verify Google Workspace connection');
			throw error;
		}
	}

	/**
	 * Lists all users in the Google Workspace domain.
	 * This method handles pagination to retrieve the complete list of users.
	 * If allowedUserEmails is configured, only users in that list will be yielded.
	 * @returns An async generator that yields each user object.
	 */
	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		const authClient = this.getAuthClient(this.credentials.impersonatedAdminEmail, [
			'https://www.googleapis.com/auth/admin.directory.user.readonly',
		]);

		const admin = google.admin({ version: 'directory_v1', auth: authClient });
		let pageToken: string | undefined = undefined;

		// Normalize allowed emails to lowercase for case-insensitive comparison
		const allowedEmails = this.credentials.allowedUserEmails?.map((email) =>
			email.toLowerCase().trim()
		);
		const hasFilter = allowedEmails && allowedEmails.length > 0;

		if (hasFilter) {
			logger.info(
				{ allowedEmails },
				'Filtering Google Workspace users to only archive specified emails'
			);
		}

		let totalUsersFound = 0;

		do {
			const res: Common.GaxiosResponseWithHTTP2<admin_directory_v1.Schema$Users> =
				await admin.users.list({
					customer: 'my_customer',
					maxResults: 500, // Max allowed per page
					pageToken: pageToken,
					orderBy: 'email',
				});

			const users = res.data.users;
			if (users) {
				for (const user of users) {
					totalUsersFound++;
					if (user.id && user.primaryEmail && user.name?.fullName) {
						// If filter is configured, only yield users whose email is in the allowed list
						if (hasFilter && !allowedEmails.includes(user.primaryEmail.toLowerCase())) {
							logger.debug(
								{ email: user.primaryEmail },
								'Skipping user - not in allowed list'
							);
							continue;
						}
						logger.info(
							{ email: user.primaryEmail },
							'User matched filter, will process mailbox'
						);
						yield {
							id: user.id,
							primaryEmail: user.primaryEmail,
							displayName: user.name.fullName,
						};
					}
				}
			}
			pageToken = res.data.nextPageToken ?? undefined;
		} while (pageToken);

		logger.info({ totalUsersFound, hasFilter }, 'Finished listing Google Workspace users');
	}

	/**
	 * Fetches emails for a single user, starting from a specific history ID.
	 * This is ideal for continuous synchronization jobs.
	 * @param userEmail The email of the user whose mailbox will be read.
	 * @param syncState Optional state containing the startHistoryId.
	 * @returns An async generator that yields each raw email object.
	 */
	public async *fetchEmails(
		userEmail: string,
		syncState?: SyncState | null,
		checkDuplicate?: (messageId: string) => Promise<boolean>
	): AsyncGenerator<EmailObject> {
		const authClient = this.getAuthClient(userEmail, [
			'https://www.googleapis.com/auth/gmail.readonly',
		]);
		const gmail = google.gmail({ version: 'v1', auth: authClient });
		let pageToken: string | undefined = undefined;

		const startHistoryId = syncState?.google?.[userEmail]?.historyId;

		// If no sync state is provided for this user, this is an initial import. Get all messages.
		if (!startHistoryId) {
			yield* this.fetchAllMessagesForUser(gmail, userEmail, checkDuplicate);
			return;
		}

		this.newHistoryId = startHistoryId;

		do {
			const historyResponse: Common.GaxiosResponseWithHTTP2<gmail_v1.Schema$ListHistoryResponse> =
				await gmail.users.history.list({
					userId: userEmail,
					startHistoryId: this.newHistoryId,
					pageToken: pageToken,
					historyTypes: ['messageAdded'],
				});

			const histories = historyResponse.data.history;
			if (!histories || histories.length === 0) {
				return;
			}

			for (const historyRecord of histories) {
				if (historyRecord.messagesAdded) {
					for (const messageAdded of historyRecord.messagesAdded) {
						if (messageAdded.message?.id) {
							try {
								const messageId = messageAdded.message.id;

								// Optimization: Check for existence before fetching full content
								if (checkDuplicate && (await checkDuplicate(messageId))) {
									logger.debug(
										{ messageId, userEmail },
										'Skipping duplicate email (pre-check)'
									);
									continue;
								}

								const metadataResponse = await gmail.users.messages.get({
									userId: userEmail,
									id: messageId,
									format: 'METADATA',
									fields: 'labelIds',
								});
								const labels = await this.getLabelDetails(
									gmail,
									userEmail,
									metadataResponse.data.labelIds || []
								);

								const msgResponse = await gmail.users.messages.get({
									userId: userEmail,
									id: messageId,
									format: 'RAW',
								});

								if (msgResponse.data.raw) {
									const rawEmail = Buffer.from(msgResponse.data.raw, 'base64url');
									const parsedEmail: ParsedMail = await simpleParser(rawEmail);
									const attachments = parsedEmail.attachments.map(
										(attachment: Attachment) => ({
											filename: attachment.filename || 'untitled',
											contentType: attachment.contentType,
											size: attachment.size,
											content: attachment.content as Buffer,
										})
									);
									const mapAddresses = (
										addresses: AddressObject | AddressObject[] | undefined
									): EmailAddress[] => {
										if (!addresses) return [];
										const addressArray = Array.isArray(addresses)
											? addresses
											: [addresses];
										return addressArray.flatMap((a) =>
											a.value.map((v) => ({
												name: v.name,
												address: v.address || '',
											}))
										);
									};
									const threadId = getThreadId(parsedEmail.headers);
									console.log('threadId', threadId);
									yield {
										id: msgResponse.data.id!,
										threadId,
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
										path: labels.path,
										tags: labels.tags,
									};
								}
							} catch (error: any) {
								if (error.code === 404) {
									logger.warn(
										{ messageId: messageAdded.message.id, userEmail },
										'Message not found, skipping.'
									);
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

	private async *fetchAllMessagesForUser(
		gmail: gmail_v1.Gmail,
		userEmail: string,
		checkDuplicate?: (messageId: string) => Promise<boolean>
	): AsyncGenerator<EmailObject> {
		// Capture the history ID at the start to ensure no emails are missed during the import process.
		// Any emails arriving during this import will be covered by the next sync starting from this point.
		// Overlaps are handled by the duplicate check.
		const profileResponse = await gmail.users.getProfile({ userId: userEmail });
		if (profileResponse.data.historyId) {
			this.newHistoryId = profileResponse.data.historyId;
		}

		let pageToken: string | undefined = undefined;
		do {
			const listResponse: Common.GaxiosResponseWithHTTP2<gmail_v1.Schema$ListMessagesResponse> =
				await gmail.users.messages.list({
					userId: userEmail,
					pageToken: pageToken,
				});

			const messages = listResponse.data.messages;
			if (!messages || messages.length === 0) {
				return;
			}

			for (const message of messages) {
				if (message.id) {
					try {
						const messageId = message.id;

						// Optimization: Check for existence before fetching full content
						if (checkDuplicate && (await checkDuplicate(messageId))) {
							logger.debug(
								{ messageId, userEmail },
								'Skipping duplicate email (pre-check)'
							);
							continue;
						}

						const metadataResponse = await gmail.users.messages.get({
							userId: userEmail,
							id: messageId,
							format: 'METADATA',
							fields: 'labelIds',
						});
						const labels = await this.getLabelDetails(
							gmail,
							userEmail,
							metadataResponse.data.labelIds || []
						);

						const msgResponse = await gmail.users.messages.get({
							userId: userEmail,
							id: messageId,
							format: 'RAW',
						});

						if (msgResponse.data.raw) {
							const rawEmail = Buffer.from(msgResponse.data.raw, 'base64url');
							const parsedEmail: ParsedMail = await simpleParser(rawEmail);
							const attachments = parsedEmail.attachments.map(
								(attachment: Attachment) => ({
									filename: attachment.filename || 'untitled',
									contentType: attachment.contentType,
									size: attachment.size,
									content: attachment.content as Buffer,
								})
							);
							const mapAddresses = (
								addresses: AddressObject | AddressObject[] | undefined
							): EmailAddress[] => {
								if (!addresses) return [];
								const addressArray = Array.isArray(addresses)
									? addresses
									: [addresses];
								return addressArray.flatMap((a) =>
									a.value.map((v) => ({ name: v.name, address: v.address || '' }))
								);
							};
							const threadId = getThreadId(parsedEmail.headers);
							console.log('threadId', threadId);
							yield {
								id: msgResponse.data.id!,
								threadId,
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
								path: labels.path,
								tags: labels.tags,
							};
						}
					} catch (error: any) {
						if (error.code === 404) {
							logger.warn(
								{ messageId: message.id, userEmail },
								'Message not found during initial import, skipping.'
							);
						} else {
							throw error;
						}
					}
				}
			}
			pageToken = listResponse.data.nextPageToken ?? undefined;
		} while (pageToken);
	}

	public getUpdatedSyncState(userEmail: string): SyncState {
		if (!this.newHistoryId) {
			return {};
		}
		return {
			google: {
				[userEmail]: {
					historyId: this.newHistoryId,
				},
			},
		};
	}

	private labelCache: Map<string, gmail_v1.Schema$Label> = new Map();

	private async getLabelDetails(
		gmail: gmail_v1.Gmail,
		userEmail: string,
		labelIds: string[]
	): Promise<{ path: string; tags: string[] }> {
		const tags: string[] = [];
		let path = '';

		for (const labelId of labelIds) {
			let label = this.labelCache.get(labelId);
			if (!label) {
				const res = await gmail.users.labels.get({ userId: userEmail, id: labelId });
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
