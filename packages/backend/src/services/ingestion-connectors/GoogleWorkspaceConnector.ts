import { google } from 'googleapis';
import type { admin_directory_v1, gmail_v1, Common } from 'googleapis';
import type {
	GoogleWorkspaceCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector, ConnectorOptions } from '../EmailProviderFactory';
import { logger } from '../../config/logger';
import { simpleParser, ParsedMail, Attachment, AddressObject, Headers } from 'mailparser';
import { getThreadId } from './helpers/utils';
import { writeEmailToTempFile } from './helpers/tempFile';
import {
	MAX_GMAIL_RAW_BYTES,
	gmailSizeEstimateExceedsLimit,
	rawBase64ExceedsLimit,
} from '../../helpers/gmailLimits';

function isHttpNotFound(error: unknown): boolean {
	const e = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
	return [e.code, e.status, e.response?.status].some((value) => value === 404 || value === '404');
}

function gmailPayloadHasAttachments(message: gmail_v1.Schema$Message): boolean {
	const walk = (part?: gmail_v1.Schema$MessagePart): boolean => {
		if (!part) {
			return false;
		}
		if (part.filename) {
			return true;
		}
		return (part.parts ?? []).some(walk);
	};
	return walk(message.payload);
}

/**
 * A connector for Google Workspace that uses a service account with domain-wide delegation
 * to access user data on behalf of users in the domain.
 */
export class GoogleWorkspaceConnector implements IEmailConnector {
	private credentials: GoogleWorkspaceCredentials;
	private serviceAccountCreds: { client_email: string; private_key: string };
	private newHistoryId: string | undefined;
	private backfillPending = false;
	private backfillPageToken: string | null = null;
	private options: ConnectorOptions;

	constructor(credentials: GoogleWorkspaceCredentials, options?: ConnectorOptions) {
		this.credentials = credentials;
		this.options = options ?? { preserveOriginalFile: false };
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
	 * @returns An async generator that yields each user object.
	 */
	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		const authClient = this.getAuthClient(this.credentials.impersonatedAdminEmail, [
			'https://www.googleapis.com/auth/admin.directory.user.readonly',
		]);

		const admin = google.admin({ version: 'directory_v1', auth: authClient });
		let pageToken: string | undefined = undefined;

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
					if (user.id && user.primaryEmail && user.name?.fullName) {
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
		checkDuplicate?: (messageId: string) => Promise<boolean>,
		checkGroupHasMessageId?: (rfcMessageId: string) => boolean | Promise<boolean>,
		onSyncStateProgress?: (state: SyncState) => void | Promise<void>
	): AsyncGenerator<EmailObject> {
		const authClient = this.getAuthClient(userEmail, [
			'https://www.googleapis.com/auth/gmail.readonly',
		]);
		const gmail = google.gmail({ version: 'v1', auth: authClient });

		const mailboxState = syncState?.google?.[userEmail];
		const startHistoryId = mailboxState?.historyId;
		const backfillPending = mailboxState?.backfillPending === true;
		const backfillPageToken = mailboxState?.backfillPageToken ?? undefined;

		if (!startHistoryId || backfillPending) {
			yield* this.fetchAllMessagesForUser(
				gmail,
				userEmail,
				checkDuplicate,
				checkGroupHasMessageId,
				onSyncStateProgress,
				{
					resumePageToken: backfillPageToken || undefined,
					existingHistoryId: startHistoryId,
				}
			);
			return;
		}

		this.newHistoryId = startHistoryId;
		this.backfillPending = false;
		this.backfillPageToken = null;

		try {
			yield* this.fetchHistoryMessages(
				gmail,
				userEmail,
				startHistoryId,
				checkDuplicate,
				checkGroupHasMessageId
			);
		} catch (error: unknown) {
			if (isHttpNotFound(error)) {
				logger.warn(
					{ userEmail, startHistoryId },
					'Gmail history expired; falling back to messages.list backfill'
				);
				yield* this.fetchAllMessagesForUser(
					gmail,
					userEmail,
					checkDuplicate,
					checkGroupHasMessageId,
					onSyncStateProgress,
					{ existingHistoryId: undefined }
				);
				return;
			}
			throw error;
		}
	}

	private async *fetchHistoryMessages(
		gmail: gmail_v1.Gmail,
		userEmail: string,
		startHistoryId: string,
		checkDuplicate?: (messageId: string) => Promise<boolean>,
		checkGroupHasMessageId?: (rfcMessageId: string) => boolean | Promise<boolean>
	): AsyncGenerator<EmailObject> {
		let pageToken: string | undefined = undefined;

		do {
			const historyResponse: Common.GaxiosResponseWithHTTP2<gmail_v1.Schema$ListHistoryResponse> =
				await gmail.users.history.list({
					userId: userEmail,
					// Keep the original startHistoryId for every page. Updating it mid-pagination
					// to the response historyId (the mailbox tip) breaks the range.
					startHistoryId,
					pageToken: pageToken,
					historyTypes: ['messageAdded'],
				});

			if (historyResponse.data.historyId) {
				this.newHistoryId = historyResponse.data.historyId;
			}

			const histories = historyResponse.data.history;
			if (!histories || histories.length === 0) {
				return;
			}

			for (const historyRecord of histories) {
				if (historyRecord.messagesAdded) {
					for (const messageAdded of historyRecord.messagesAdded) {
						if (messageAdded.message?.id) {
							try {
								yield* this.fetchSingleMessage(
									gmail,
									userEmail,
									messageAdded.message.id,
									checkDuplicate,
									checkGroupHasMessageId
								);
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
		} while (pageToken);
	}

	private async *fetchAllMessagesForUser(
		gmail: gmail_v1.Gmail,
		userEmail: string,
		checkDuplicate?: (messageId: string) => Promise<boolean>,
		checkGroupHasMessageId?: (rfcMessageId: string) => boolean | Promise<boolean>,
		onSyncStateProgress?: (state: SyncState) => void | Promise<void>,
		resume?: { resumePageToken?: string; existingHistoryId?: string }
	): AsyncGenerator<EmailObject> {
		// Capture the history ID at the start so a crash mid-backfill still leaves
		// a valid incremental cursor. Persist immediately — waiting until the mailbox
		// job finishes is what forced a full re-import of the same mailbox every cycle.
		if (resume?.existingHistoryId) {
			this.newHistoryId = resume.existingHistoryId;
		} else {
			const profileResponse = await gmail.users.getProfile({ userId: userEmail });
			if (profileResponse.data.historyId) {
				this.newHistoryId = profileResponse.data.historyId;
			}
		}

		this.backfillPending = true;
		this.backfillPageToken = resume?.resumePageToken ?? null;
		await onSyncStateProgress?.(this.getUpdatedSyncState(userEmail));
		logger.warn(
			{
				userEmail,
				historyId: this.newHistoryId,
				resumePageToken: this.backfillPageToken,
			},
			'Starting Gmail messages.list backfill; historyId persisted'
		);

		let pageToken: string | undefined = resume?.resumePageToken;
		do {
			const listResponse: Common.GaxiosResponseWithHTTP2<gmail_v1.Schema$ListMessagesResponse> =
				await gmail.users.messages.list({
					userId: userEmail,
					pageToken: pageToken,
					maxResults: 100,
				});

			const messages = listResponse.data.messages;
			if (!messages || messages.length === 0) {
				break;
			}

			// Persist the *next* page token before processing this page. If the worker
			// OOMs mid-page, the next cycle must not retry the same 100 IDs forever.
			pageToken = listResponse.data.nextPageToken ?? undefined;
			this.backfillPageToken = pageToken ?? null;
			await onSyncStateProgress?.(this.getUpdatedSyncState(userEmail));

			for (const message of messages) {
				if (message.id) {
					try {
						yield* this.fetchSingleMessage(
							gmail,
							userEmail,
							message.id,
							checkDuplicate,
							checkGroupHasMessageId
						);
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
		} while (pageToken);

		this.backfillPending = false;
		this.backfillPageToken = null;
		await onSyncStateProgress?.(this.getUpdatedSyncState(userEmail));
		logger.warn({ userEmail, historyId: this.newHistoryId }, 'Gmail messages.list backfill finished');
	}

	private async *fetchSingleMessage(
		gmail: gmail_v1.Gmail,
		userEmail: string,
		messageId: string,
		checkDuplicate?: (messageId: string) => Promise<boolean>,
		checkGroupHasMessageId?: (rfcMessageId: string) => boolean | Promise<boolean>
	): AsyncGenerator<EmailObject> {
		if (checkDuplicate && (await checkDuplicate(messageId))) {
			logger.debug({ messageId, userEmail }, 'Skipping duplicate email (pre-check)');
			return;
		}

		const metadataResponse = await gmail.users.messages.get({
			userId: userEmail,
			id: messageId,
			format: 'METADATA',
			metadataHeaders: ['Message-ID', 'Subject', 'From', 'To', 'Cc', 'Date'],
		});

		const labels = await this.getLabelDetails(
			gmail,
			userEmail,
			metadataResponse.data.labelIds || []
		);

		const rfcMessageId = this.extractRfcMessageId(metadataResponse.data);
		if (rfcMessageId && checkGroupHasMessageId && (await checkGroupHasMessageId(rfcMessageId))) {
			logger.debug(
				{ messageId, rfcMessageId, userEmail },
				'Skipping RAW download (group already has RFC Message-ID)'
			);
			yield await this.parseMetadataOnly(
				messageId,
				userEmail,
				metadataResponse.data,
				labels.path,
				labels.tags
			);
			return;
		}

		if (gmailSizeEstimateExceedsLimit(metadataResponse.data.sizeEstimate)) {
			logger.warn(
				{
					messageId,
					userEmail,
					sizeEstimate: metadataResponse.data.sizeEstimate,
					maxBytes: MAX_GMAIL_RAW_BYTES,
				},
				'Skipping oversized Gmail message (sizeEstimate) to avoid heap OOM'
			);
			return;
		}

		const email = await this.downloadRawWithoutFullParse(
			gmail,
			userEmail,
			messageId,
			metadataResponse.data,
			labels.path,
			labels.tags
		);
		if (email) {
			yield email;
		}
	}

	public async fetchRawEmail(userEmail: string, messageId: string): Promise<EmailObject | null> {
		const authClient = this.getAuthClient(userEmail, [
			'https://www.googleapis.com/auth/gmail.readonly',
		]);
		const gmail = google.gmail({ version: 'v1', auth: authClient });
		const metadataResponse = await gmail.users.messages.get({
			userId: userEmail,
			id: messageId,
			format: 'METADATA',
			metadataHeaders: ['Message-ID', 'Subject', 'From', 'To', 'Cc', 'Date'],
		});
		if (gmailSizeEstimateExceedsLimit(metadataResponse.data.sizeEstimate)) {
			logger.warn(
				{
					messageId,
					userEmail,
					sizeEstimate: metadataResponse.data.sizeEstimate,
					maxBytes: MAX_GMAIL_RAW_BYTES,
				},
				'Skipping oversized Gmail RAW fallback (sizeEstimate) to avoid heap OOM'
			);
			return null;
		}
		const labels = await this.getLabelDetails(
			gmail,
			userEmail,
			metadataResponse.data.labelIds || []
		);
		return this.downloadRawWithoutFullParse(
			gmail,
			userEmail,
			messageId,
			metadataResponse.data,
			labels.path,
			labels.tags
		);
	}

	/**
	 * Writes RAW bytes to a temp file and builds the EmailObject from METADATA
	 * headers only. simpleParser on the full MIME body is what triggers
	 * `invalid array length` on a single malformed/huge message.
	 */
	private async downloadRawWithoutFullParse(
		gmail: gmail_v1.Gmail,
		userEmail: string,
		messageId: string,
		metadata: gmail_v1.Schema$Message,
		path: string,
		tags: string[]
	): Promise<EmailObject | null> {
		const msgResponse = await gmail.users.messages.get({
			userId: userEmail,
			id: messageId,
			format: 'RAW',
		});
		if (!msgResponse.data.raw) {
			return null;
		}
		if (rawBase64ExceedsLimit(msgResponse.data.raw)) {
			logger.warn(
				{
					messageId,
					userEmail,
					rawChars: msgResponse.data.raw.length,
					maxBytes: MAX_GMAIL_RAW_BYTES,
				},
				'Skipping oversized Gmail RAW message to avoid heap OOM'
			);
			return null;
		}

		const rawEmail = Buffer.from(msgResponse.data.raw, 'base64url');
		const tempFilePath = await writeEmailToTempFile(rawEmail);
		const email = await this.parseMetadataOnly(
			msgResponse.data.id ?? messageId,
			userEmail,
			metadata,
			path,
			tags
		);
		email.tempFilePath = tempFilePath;
		if (gmailPayloadHasAttachments(metadata)) {
			email.attachments = [
				{
					filename: 'attachment',
					contentType: 'application/octet-stream',
					size: 0,
					content: Buffer.alloc(0),
				},
			];
		}
		return email;
	}

	private extractRfcMessageId(message: gmail_v1.Schema$Message): string | undefined {
		const header = message.payload?.headers?.find((h) => h.name?.toLowerCase() === 'message-id');
		return header?.value?.trim() || undefined;
	}

	private async parseMetadataOnly(
		gmailMessageId: string,
		userEmail: string,
		message: gmail_v1.Schema$Message,
		path: string,
		tags: string[]
	): Promise<EmailObject> {
		const getHeader = (name: string): string | undefined => {
			const header = message.payload?.headers?.find(
				(h) => h.name?.toLowerCase() === name.toLowerCase()
			);
			return header?.value ?? undefined;
		};

		const headerLines: string[] = [];
		for (const name of ['Message-ID', 'Subject', 'From', 'To', 'Cc', 'Date']) {
			const value = getHeader(name);
			if (value) {
				headerLines.push(`${name}: ${value}`);
			}
		}

		const parsedEmail: ParsedMail = await simpleParser(
			Buffer.from(`${headerLines.join('\r\n')}\r\n\r\n`)
		);

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
			id: gmailMessageId,
			threadId: message.threadId ?? undefined,
			userEmail,
			from: mapAddresses(parsedEmail.from),
			to: mapAddresses(parsedEmail.to),
			cc: mapAddresses(parsedEmail.cc),
			subject: parsedEmail.subject || '',
			body: '',
			html: '',
			headers: parsedEmail.headers,
			attachments: [],
			receivedAt: parsedEmail.date || new Date(),
			path,
			tags,
		};
	}

	/**
	 * Parses a raw email buffer into an EmailObject, extracting metadata via simpleParser.
	 * In preserve-original mode, attachment binary content is omitted to save memory.
	 */
	private async parseRawEmail(
		rawEmail: Buffer,
		messageId: string,
		userEmail: string,
		path: string,
		tags: string[]
	): Promise<EmailObject> {
		const tempFilePath = await writeEmailToTempFile(rawEmail);
		const parsedEmail: ParsedMail = await simpleParser(rawEmail);

		// In preserve-original mode, skip extracting full attachment binary content
		// to avoid unnecessary memory allocation — the raw EML on disk is the source of truth.
		const attachments = parsedEmail.attachments.map((attachment: Attachment) => ({
			filename: attachment.filename || 'untitled',
			contentType: attachment.contentType,
			size: attachment.size,
			content: this.options.preserveOriginalFile
				? Buffer.alloc(0)
				: (attachment.content as Buffer),
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

		const threadId = getThreadId(parsedEmail.headers);

		return {
			id: messageId,
			threadId,
			userEmail,
			tempFilePath,
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
			tags,
		};
	}

	public getUpdatedSyncState(userEmail: string): SyncState {
		if (!this.newHistoryId) {
			return {};
		}
		return {
			google: {
				[userEmail]: {
					historyId: this.newHistoryId,
					backfillPending: this.backfillPending,
					backfillPageToken: this.backfillPageToken,
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
