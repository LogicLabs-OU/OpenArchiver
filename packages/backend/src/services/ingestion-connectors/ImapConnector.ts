import type {
	GenericImapCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector } from '../EmailProviderFactory';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, Attachment, AddressObject, Headers } from 'mailparser';
import { logger } from '../../config/logger';
import { getThreadId } from './helpers/utils';

export class ImapConnector implements IEmailConnector {
	private client: ImapFlow;
	private newMaxUids: { [mailboxPath: string]: number } = {};
	private isConnected = false;
	private statusMessage: string | undefined;

	constructor(private credentials: GenericImapCredentials) {
		this.client = this.createClient();
	}

	private createClient(): ImapFlow {
		const client = new ImapFlow({
			host: this.credentials.host,
			port: this.credentials.port,
			secure: this.credentials.secure,
			auth: {
				user: this.credentials.username,
				pass: this.credentials.password,
			},
			logger: logger.child({ module: 'ImapFlow' }),
		});

		// Handles client-level errors, like unexpected disconnects, to prevent crashes.
		client.on('error', (err) => {
			logger.error({ err }, 'IMAP client error');
			this.isConnected = false;
		});

		return client;
	}

	/**
	 * Establishes a connection to the IMAP server if not already connected.
	 */
	private async connect(): Promise<void> {
		if (this.isConnected && this.client.usable) {
			return;
		}

		// If the client is not usable (e.g., after a logout), create a new one.
		if (!this.client.usable) {
			this.client = this.createClient();
		}

		try {
			await this.client.connect();
			this.isConnected = true;
		} catch (err: any) {
			this.isConnected = false;
			logger.error({ err }, 'IMAP connection failed');
			if (err.responseText) {
				throw new Error(`IMAP Connection Error: ${err.responseText}`);
			}
			throw err;
		}
	}

	/**
	 * Disconnects from the IMAP server if the connection is active.
	 */
	private async disconnect(): Promise<void> {
		if (this.isConnected && this.client.usable) {
			await this.client.logout();
			this.isConnected = false;
		}
	}

	public async testConnection(): Promise<boolean> {
		try {
			await this.connect();
			await this.disconnect();
			return true;
		} catch (error) {
			logger.error({ error }, 'Failed to verify IMAP connection');
			throw error;
		}
	}

	/**
	 *  We understand that for IMAP inboxes, there is only one user, but we want the IMAP connector to be compatible with other connectors, we return the single user here.
	 * @returns An async generator that yields each user object.
	 */
	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		try {
			const emails: string[] = [this.returnImapUserEmail()];
			for (const [index, email] of emails.entries()) {
				yield {
					id: String(index),
					primaryEmail: email,
					displayName: email,
				};
			}
		} finally {
			await this.disconnect();
		}
	}

	public returnImapUserEmail(): string {
		return this.credentials.username;
	}

	/**
	 * Wraps an IMAP operation with a retry mechanism to handle transient network errors.
	 * @param action The async function to execute.
	 * @param maxRetries The maximum number of retries.
	 * @returns The result of the action.
	 */
	private async withRetry<T>(action: () => Promise<T>, maxRetries = 5): Promise<T> {
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				await this.connect();
				return await action();
			} catch (err: any) {
				logger.error({ err, attempt }, `IMAP operation failed on attempt ${attempt}`);
				this.isConnected = false; // Force reconnect on next attempt
				if (attempt === maxRetries) {
					logger.error({ err }, 'IMAP operation failed after all retries.');
					throw err;
				}
				// Wait for a short period before retrying
				const delay = Math.pow(2, attempt) * 1000;
				const jitter = Math.random() * 1000;
				logger.info(`Retrying in ${Math.round((delay + jitter) / 1000)}s`);
				await new Promise((resolve) => setTimeout(resolve, delay + jitter));
			}
		}
		// This line should be unreachable
		throw new Error('IMAP operation failed after all retries.');
	}

	public async *fetchEmails(
		userEmail: string,
		syncState?: SyncState | null
	): AsyncGenerator<EmailObject | null> {
		// list all mailboxes first
		const mailboxes = await this.withRetry(async () => await this.client.list());
		await this.disconnect();

		const processableMailboxes = mailboxes.filter((mailbox) => {
			// filter out trash and all mail emails
			if (mailbox.specialUse) {
				const specialUse = mailbox.specialUse.toLowerCase();
				if (specialUse === '\\junk' || specialUse === '\\trash' || specialUse === '\\all') {
					return false;
				}
			}
			// Fallback to checking flags
			if (
				mailbox.flags.has('\\Noselect') ||
				mailbox.flags.has('\\Trash') ||
				mailbox.flags.has('\\Junk') ||
				mailbox.flags.has('\\All')
			) {
				return false;
			}

			return true;
		});

		for (const mailboxInfo of processableMailboxes) {
			const mailboxPath = mailboxInfo.path;
			logger.info({ mailboxPath }, 'Processing mailbox');

			try {
				const mailbox = await this.withRetry(
					async () => await this.client.mailboxOpen(mailboxPath)
				);
				const lastUid = syncState?.imap?.[mailboxPath]?.maxUid;
				let currentMaxUid = lastUid || 0;

				if (mailbox.exists > 0) {
					const lastMessage = await this.client.fetchOne(String(mailbox.exists), {
						uid: true,
					});
					if (lastMessage && lastMessage.uid > currentMaxUid) {
						currentMaxUid = lastMessage.uid;
					}
				}

				// Initialize with last synced UID, not the maximum UID in mailbox
				this.newMaxUids[mailboxPath] = lastUid || 0;

				// Only fetch if the mailbox has messages, to avoid errors on empty mailboxes with some IMAP servers.
				if (mailbox.exists > 0) {
					const BATCH_SIZE = 250; // A configurable batch size
					let startUid = (lastUid || 0) + 1;
					const maxUidToFetch = currentMaxUid;

					while (startUid <= maxUidToFetch) {
						const endUid = Math.min(startUid + BATCH_SIZE - 1, maxUidToFetch);
						const searchCriteria = { uid: `${startUid}:${endUid}` };

						for await (const msg of this.client.fetch(searchCriteria, {
							envelope: true,
							source: true,
							bodyStructure: true,
							uid: true,
						})) {
							if (lastUid && msg.uid <= lastUid) {
								continue;
							}

							if (msg.uid > this.newMaxUids[mailboxPath]) {
								this.newMaxUids[mailboxPath] = msg.uid;
							}

							logger.debug({ mailboxPath, uid: msg.uid }, 'Processing message');

							if (msg.envelope && msg.source) {
								try {
									yield await this.parseMessage(msg, mailboxPath);
								} catch (err: any) {
									logger.error(
										{ err, mailboxPath, uid: msg.uid },
										'Failed to parse message'
									);
									throw err;
								}
							}
						}

						// Move to the next batch
						startUid = endUid + 1;
					}
				}
			} catch (err: any) {
				logger.error({ err, mailboxPath }, 'Failed to process mailbox');
				// Check if the error indicates a persistent failure after retries
				if (err.message.includes('IMAP operation failed after all retries')) {
					this.statusMessage =
						'Sync paused due to reaching the mail server rate limit. The process will automatically resume later.';
				}
			} finally {
				await this.disconnect();
			}
		}
	}

	private async parseMessage(msg: any, mailboxPath: string): Promise<EmailObject> {
		const parsedEmail: ParsedMail = await simpleParser(msg.source);
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

		const threadId = getThreadId(parsedEmail.headers);

		return {
			id: parsedEmail.messageId || msg.uid.toString(),
			threadId: threadId,
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
			eml: msg.source,
			path: mailboxPath,
		};
	}

	public getUpdatedSyncState(): SyncState {
		const imapSyncState: { [mailboxPath: string]: { maxUid: number } } = {};
		for (const [path, uid] of Object.entries(this.newMaxUids)) {
			imapSyncState[path] = { maxUid: uid };
		}
		const syncState: SyncState = {
			imap: imapSyncState,
		};

		if (this.statusMessage) {
			syncState.statusMessage = this.statusMessage;
		}

		return syncState;
	}
}
