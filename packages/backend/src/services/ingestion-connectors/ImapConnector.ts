import type {
	GenericImapCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector, ConnectorOptions } from '../EmailProviderFactory';
import { normalizeEmailAddress } from '../../helpers/emailAddress';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, Attachment, AddressObject, Headers } from 'mailparser';
import { config } from '../../config';
import { logger } from '../../config/logger';
import { getThreadId } from './helpers/utils';
import { writeEmailToTempFile } from './helpers/tempFile';

/**
 * Whether a mailbox is the account's Drafts folder.
 *
 * `specialUse` is the reliable signal: imapflow resolves it from the SPECIAL-USE extension when the
 * server offers one and from a multilingual folder-name table when it does not, so this works
 * against servers that never advertise RFC 6154. The flag check behind it covers the remaining case
 * of a server that sets \Drafts as a plain mailbox flag.
 */
const isDraftsMailbox = (mailbox: { specialUse?: string; flags: Set<string> }): boolean =>
	mailbox.specialUse?.toLowerCase() === '\\drafts' || mailbox.flags.has('\\Drafts');

/**
 * Supplies a currently-valid OAuth access token for one XOAUTH2 connection attempt.
 * Async because supplying may mean refreshing against the provider first.
 */
export type AccessTokenSupplier = () => Promise<string>;

/**
 * Whether the server refused to open a mailbox for a credential it had just accepted.
 *
 * Exchange Online says "User is authenticated but not connected" for this, and the wording is
 * literal: the sign-in was read and the identity resolved, and only then did attaching a
 * mailbox session fail. It is NOT a rejected credential, and the difference is observable —
 * a username the server cannot resolve answers "Login failed" instead.
 *
 * On personal Outlook.com mailboxes this comes and goes minute to minute rather than being a
 * settled state; the same token that is refused now succeeds on a later connection, and one
 * successful handshake then pulls the whole mailbox. So it is transient by nature, and the
 * right response is to retry it, not to report a broken configuration.
 */
const isSessionRefused = (error: unknown): boolean =>
	(error as { authenticationFailed?: boolean })?.authenticationFailed === true &&
	/authenticated but not connected/i.test(
		String((error as { responseText?: string })?.responseText ?? '')
	);

/**
 * Whether the server rejected the credential itself.
 *
 * imapflow raises `authenticationFailed` for any NO/BAD reply to LOGIN or AUTHENTICATE, which
 * lumps a wrong password together with the session refusal above — hence the exclusion.
 * What remains cannot be improved by retrying: a wrong password stays wrong, and a revoked
 * token stays revoked. Retrying is worse than useless against Microsoft, which throttles an
 * account on repeated failed sign-ins.
 *
 * It cannot mean "the token just expired" on an OAuth source: the token supplier refreshes
 * before each connection attempt, and a refresh that fails throws before IMAP is reached.
 */
const isCredentialRejected = (error: unknown): boolean =>
	(error as { authenticationFailed?: boolean })?.authenticationFailed === true &&
	!isSessionRefused(error);

/**
 * What to report when a session refusal has outlived every retry.
 *
 * Two earlier versions of this message named a cause — first a disabled IMAP setting, then a
 * checklist of app-registration settings. Both were wrong: IMAP was already enabled, and the
 * refusal reproduces under Thunderbird's own registration, on either sign-in realm, from a raw
 * socket. Nothing the reader controls changes the outcome, so the text stops pretending
 * otherwise and says what will happen instead.
 */
const explainSessionRefusal = (isOAuth: boolean): string =>
	isOAuth
		? 'The mail server accepted the token and then refused to open the mailbox. This is ' +
			'intermittent on personal Outlook.com mailboxes and is not a configuration problem ' +
			'on this side - the same token succeeds on a later attempt. Syncing retries on the ' +
			'next cycle. If it persists for hours, switch the source to the Microsoft Graph ' +
			'transport, which does not use IMAP.'
		: 'The mail server accepted the sign-in and then refused to open the mailbox. Check that ' +
			'IMAP is enabled for this mailbox, and note that Microsoft no longer accepts ' +
			'passwords or app passwords for Outlook.com - such mailboxes need the OAuth Mailbox ' +
			'provider instead.';

export class ImapConnector implements IEmailConnector {
	/** Built lazily: with OAuth in play, constructing a client means fetching a token. */
	private client: ImapFlow | null = null;
	private newMaxUids: { [mailboxPath: string]: number } = {};
	private statusMessage: string | undefined;
	private options: ConnectorOptions;

	constructor(
		private credentials: GenericImapCredentials,
		options?: ConnectorOptions,
		private accessTokenSupplier?: AccessTokenSupplier
	) {
		this.options = options ?? { preserveOriginalFile: false };
	}

	private async createClient(): Promise<ImapFlow> {
		// The supplier is consulted per client build — which is per connection attempt —
		// so every reconnect inside withRetry authenticates with a token that is valid
		// NOW, not one captured when the connector was constructed. Access tokens outlive
		// a connection attempt but not a long sync.
		const auth = this.accessTokenSupplier
			? { user: this.credentials.username, accessToken: await this.accessTokenSupplier() }
			: { user: this.credentials.username, pass: this.credentials.password };

		const client = new ImapFlow({
			host: this.credentials.host,
			port: this.credentials.port,
			secure: this.credentials.secure,
			tls: {
				rejectUnauthorized: !this.credentials.allowInsecureCert,
				requestCert: true,
			},
			auth,
			logger: logger.child({ module: 'ImapFlow' }),
		});

		// Handles client-level errors, like unexpected disconnects, to prevent crashes.
		client.on('error', (err) => {
			logger.error({ err }, 'IMAP client error');
		});

		return client;
	}

	/**
	 * Establishes a connection to the IMAP server if not already connected.
	 */
	private async connect(): Promise<void> {
		// If the client is already connected and usable, do nothing.
		if (this.client?.usable) {
			return;
		}

		// If the client is not usable (e.g., after a logout or an error), create a new one.
		this.client = await this.createClient();

		try {
			await this.client.connect();
		} catch (err: any) {
			logger.error({ err }, 'IMAP connection failed');
			if (isSessionRefused(err)) {
				// Rethrown WITHOUT authenticationFailed: the credential was accepted, and
				// leaving the flag on would make withRetry and the job layer read a passing
				// retry candidate as a settings problem to give up on.
				throw Object.assign(
					new Error(explainSessionRefusal(Boolean(this.accessTokenSupplier))),
					{ sessionRefused: true }
				);
			}
			if (err.responseText) {
				if (isCredentialRejected(err)) {
					throw Object.assign(new Error(`IMAP Connection Error: ${err.responseText}`), {
						authenticationFailed: true,
					});
				}
				throw new Error(`IMAP Connection Error: ${err.responseText}`);
			}
			throw err;
		}
	}

	/**
	 * Disconnects from the IMAP server if the connection is active.
	 */
	private async disconnect(): Promise<void> {
		if (this.client?.usable) {
			await this.client.logout();
		}
	}

	/**
	 * The live client, for use strictly after connect() has succeeded (withRetry calls it
	 * before every action). The assertion documents that contract for the type system.
	 */
	private get imap(): ImapFlow {
		if (!this.client) {
			throw new Error('IMAP client used before connect()');
		}
		return this.client;
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

	/**
	 * The mailbox identity for an IMAP source is the username an administrator typed into the
	 * connection form, so it is the value most likely to carry stray padding or unexpected casing.
	 */
	public returnImapUserEmail(): string {
		return normalizeEmailAddress(this.credentials.username);
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
				// A rejected credential is final. Retrying it wastes the whole backoff ladder
				// on every mailbox of every cycle, and invites the provider to throttle the
				// account for repeated failed attempts.
				//
				// A REFUSED SESSION is not in that category and deliberately falls through to
				// the ladder below: the credential was accepted, the refusal is transient, and
				// one handshake that gets through fetches the entire mailbox.
				if (isCredentialRejected(err)) {
					logger.error({ err }, 'IMAP credentials rejected; not retrying');
					throw err;
				}
				logger.error({ err, attempt }, `IMAP operation failed on attempt ${attempt}`);
				// The client is no longer usable, a new one will be created on the next attempt.
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
		syncState?: SyncState | null,
		checkDuplicate?: (messageId: string) => Promise<boolean>
	): AsyncGenerator<EmailObject | null> {
		try {
			// list all mailboxes first
			const mailboxes = await this.withRetry(async () => await this.imap.list());

			const processableMailboxes = mailboxes.filter((mailbox) => {
				// Exclude mailboxes that cannot be selected.
				if (mailbox.flags.has('\\Noselect')) {
					return false;
				}
				// Drafts, before the all-inclusive short-circuit below: that setting is about Junk
				// and Trash, and someone who wants their spam archived has not thereby asked for
				// every half-written message too. Excluding the folder rather than filtering later
				// means a draft is never downloaded at all. imapflow fills in specialUse from a
				// folder-name table as well as RFC 6154, so this holds on servers with no
				// SPECIAL-USE extension.
				if (!config.ingestion.archiveDrafts && isDraftsMailbox(mailbox)) {
					return false;
				}
				if (config.app.allInclusiveArchive) {
					return true;
				}
				// filter out junk/spam mail emails
				if (mailbox.specialUse) {
					const specialUse = mailbox.specialUse.toLowerCase();
					if (specialUse === '\\junk' || specialUse === '\\trash') {
						return false;
					}
				}
				// Fallback to checking flags
				if (mailbox.flags.has('\\Trash') || mailbox.flags.has('\\Junk')) {
					return false;
				}

				return true;
			});

			for (const mailboxInfo of processableMailboxes) {
				const mailboxPath = mailboxInfo.path;
				logger.info({ mailboxPath }, 'Processing mailbox');

				try {
					const mailbox = await this.withRetry(
						async () => await this.imap.mailboxOpen(mailboxPath)
					);
					const lastUid = syncState?.imap?.[mailboxPath]?.maxUid;
					let currentMaxUid = lastUid || 0;

					if (mailbox.exists > 0) {
						const lastMessage = await this.imap.fetchOne(String(mailbox.exists), {
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
						const BATCH_SIZE = 250;
						let startUid = (lastUid || 0) + 1;
						const maxUidToFetch = currentMaxUid;

						while (startUid <= maxUidToFetch) {
							const endUid = Math.min(startUid + BATCH_SIZE - 1, maxUidToFetch);
							const searchCriteria = { uid: `${startUid}:${endUid}` };

							// --- Pass 1: fetch only envelope + uid (no source) for the entire batch.
							const uidsToFetch: number[] = [];

							for await (const msg of this.imap.fetch(searchCriteria, {
								envelope: true,
								uid: true,
								flags: true,
							})) {
								if (lastUid && msg.uid <= lastUid) {
									continue;
								}

								if (msg.uid > this.newMaxUids[mailboxPath]) {
									this.newMaxUids[mailboxPath] = msg.uid;
								}

								// A draft filed outside the Drafts folder — the folder filter above
								// cannot see these, and skipping here means the body is never
								// fetched, same as for a duplicate.
								if (!config.ingestion.archiveDrafts && msg.flags?.has('\\Draft')) {
									logger.debug(
										{ mailboxPath, uid: msg.uid },
										'Skipping message flagged as a draft'
									);
									continue;
								}

								// Duplicate check against the Message-ID from the envelope.
								// If a duplicate is found we skip fetching the full source entirely,
								// avoiding loading attachment binary data into memory for known emails.
								if (checkDuplicate && msg.envelope?.messageId) {
									const isDuplicate = await checkDuplicate(
										msg.envelope.messageId
									);
									if (isDuplicate) {
										logger.debug(
											{
												mailboxPath,
												uid: msg.uid,
												messageId: msg.envelope.messageId,
											},
											'Skipping duplicate email (pre-check)'
										);
										continue;
									}
								}

								if (msg.envelope) {
									uidsToFetch.push(msg.uid);
								}
							}

							// --- Pass 2: fetch full source one message at a time for non-duplicate UIDs.
							for (const uid of uidsToFetch) {
								logger.debug(
									{ mailboxPath, uid },
									'Fetching full source for message'
								);

								try {
									const fullMsg = await this.withRetry(
										async () =>
											await this.imap.fetchOne(
												String(uid),
												{
													envelope: true,
													source: true,
													bodyStructure: true,
													uid: true,
													flags: true,
												},
												{ uid: true }
											)
									);

									if (fullMsg && fullMsg.envelope && fullMsg.source) {
										yield await this.parseMessage(fullMsg, mailboxPath);
									}
								} catch (err: any) {
									logger.error(
										{ err, mailboxPath, uid },
										'Failed to fetch or parse message'
									);
									throw err;
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
				}
			}
		} finally {
			await this.disconnect();
		}
	}

	private async parseMessage(msg: any, mailboxPath: string): Promise<EmailObject> {
		// Write raw bytes to temp file to keep large buffers off the JS heap
		const tempFilePath = await writeEmailToTempFile(msg.source);

		// Parse only for metadata extraction (read-only)
		const parsedEmail: ParsedMail = await simpleParser(msg.source);

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
			tempFilePath,
			path: mailboxPath,
			isDraft: msg.flags?.has('\\Draft') || undefined,
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
