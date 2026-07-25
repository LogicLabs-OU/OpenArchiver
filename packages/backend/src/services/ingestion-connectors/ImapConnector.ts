import type {
	GenericImapCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector, ConnectorOptions } from '../EmailProviderFactory';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, Attachment, AddressObject, Headers } from 'mailparser';
import { config } from '../../config';
import { logger } from '../../config/logger';
import { getThreadId } from './helpers/utils';
import { writeEmailToTempFile } from './helpers/tempFile';

export class ImapConnector implements IEmailConnector {
	private client: ImapFlow;
	private newMaxUids: { [mailboxPath: string]: number } = {};
	private statusMessage: string | undefined;
	private options: ConnectorOptions;
	// Test seam: when provided, client creation is delegated to this factory
	// instead of constructing a real ImapFlow. Also used by connect()'s
	// rebuild path, so retries get a fresh injected client. Undefined in prod.
	private clientFactory?: () => ImapFlow;

	constructor(
		private credentials: GenericImapCredentials,
		options?: ConnectorOptions,
		clientFactory?: () => ImapFlow
	) {
		this.options = options ?? { preserveOriginalFile: false };
		this.clientFactory = clientFactory;
		this.client = this.createClient();
	}

	private createClient(): ImapFlow {
		if (this.clientFactory) {
			return this.clientFactory();
		}
		const client = new ImapFlow({
			host: this.credentials.host,
			port: this.credentials.port,
			secure: this.credentials.secure,
			tls: {
				rejectUnauthorized: !this.credentials.allowInsecureCert,
				requestCert: true,
			},
			auth: {
				user: this.credentials.username,
				pass: this.credentials.password,
			},
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
		if (this.client.usable) {
			return;
		}

		// If the client is not usable (e.g., after a logout or an error), create a new one.
		this.client = this.createClient();

		try {
			await this.client.connect();
		} catch (err: any) {
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
		if (this.client.usable) {
			await this.client.logout();
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
		checkDuplicate?: (messageId: string) => Promise<boolean>,
		checkDuplicatesBatch?: (messageIds: string[]) => Promise<Set<string>>
	): AsyncGenerator<EmailObject | null> {
		try {
			// list all mailboxes first
			const mailboxes = await this.withRetry(async () => await this.client.list());

			const processableMailboxes = mailboxes.filter((mailbox) => {
				// Exclude mailboxes that cannot be selected.
				if (mailbox.flags.has('\\Noselect')) {
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
						const BATCH_SIZE = config.ingestion.imapFetchBatchSize;
						let startUid = (lastUid || 0) + 1;
						const maxUidToFetch = currentMaxUid;

						while (startUid <= maxUidToFetch) {
							const endUid = Math.min(startUid + BATCH_SIZE - 1, maxUidToFetch);
							const searchCriteria = { uid: `${startUid}:${endUid}` };

							// --- Pass 1: fetch only envelope + uid (no source) for the entire
							// batch, collecting candidates first so duplicates can be checked
							// in ONE query (checkDuplicatesBatch) rather than one per message
							// — the per-message round-trip dominated re-scans of an
							// already-archived mailbox. Falls back to the per-message
							// checkDuplicate when no batch checker is supplied.
							const uidsToFetch: number[] = [];
							const candidates: Array<{ uid: number; messageId?: string }> = [];

							for await (const msg of this.client.fetch(searchCriteria, {
								envelope: true,
								uid: true,
							})) {
								if (lastUid && msg.uid <= lastUid) {
									continue;
								}

								// NB: the checkpointable maxUid is advanced at batch-end
								// (below), NOT here per-envelope — advancing it during the
								// Pass 1 scan would let a mid-job checkpoint report a UID
								// whose body hasn't been fetched/archived yet, causing the
								// next resume to skip it.
								if (msg.envelope) {
									candidates.push({
										uid: msg.uid,
										messageId: msg.envelope.messageId ?? undefined,
									});
								}
							}

							// One batched dedup lookup for the whole envelope batch, when
							// available. A duplicate is skipped so its full source (and any
							// attachment binary) is never fetched.
							let existingIds: Set<string> | null = null;
							if (checkDuplicatesBatch) {
								const ids = candidates
									.map((c) => c.messageId)
									.filter((id): id is string => !!id);
								existingIds =
									ids.length > 0
										? await checkDuplicatesBatch(ids)
										: new Set<string>();
							}

							for (const candidate of candidates) {
								if (candidate.messageId) {
									const isDuplicate = existingIds
										? existingIds.has(candidate.messageId)
										: checkDuplicate
											? await checkDuplicate(candidate.messageId)
											: false;
									if (isDuplicate) {
										logger.debug(
											{
												mailboxPath,
												uid: candidate.uid,
												messageId: candidate.messageId,
											},
											'Skipping duplicate email (pre-check)'
										);
										continue;
									}
								}
								uidsToFetch.push(candidate.uid);
							}

							// --- Pass 2: bulk-fetch full source for all non-duplicate UIDs in a
							// SINGLE ranged IMAP FETCH (pipelined by the server) instead of one
							// FETCH command per message — the previous per-message round-trip was
							// the dominant ingest bottleneck. Stream + yield as each arrives so the
							// heap stays bounded to one message (matches the temp-file design). On
							// a mid-stream disconnect, reconnect and re-fetch only the UIDs not yet
							// yielded, preserving the previous per-message retry robustness.
							if (uidsToFetch.length > 0) {
								const yielded = new Set<number>();
								const maxRetries = 5;
								let attempt = 0;

								while (true) {
									const remaining = uidsToFetch.filter((u) => !yielded.has(u));
									if (remaining.length === 0) {
										break;
									}

									// Set only when parseMessage (not the network) throws, so a bad
									// message aborts the mailbox instead of being retried as if it
									// were a transient fetch failure.
									let parseError: unknown = null;

									try {
										await this.connect();
										logger.debug(
											{ mailboxPath, count: remaining.length },
											'Bulk-fetching full source for non-duplicate messages'
										);

										for await (const fullMsg of this.client.fetch(
											{ uid: remaining.join(',') },
											{
												envelope: true,
												source: true,
												bodyStructure: true,
												uid: true,
											}
										)) {
											// Mark received BEFORE parsing so a reconnect never
											// re-fetches or double-yields this message.
											if (fullMsg?.uid) {
												yielded.add(fullMsg.uid);
											}

											if (fullMsg && fullMsg.envelope && fullMsg.source) {
												let parsed: EmailObject;
												try {
													parsed = await this.parseMessage(
														fullMsg,
														mailboxPath
													);
												} catch (err) {
													parseError = err;
													break;
												}
												yield parsed;
											}
										}
									} catch (err: any) {
										// Network/stream error → reconnect and retry only the
										// still-unyielded UIDs with exponential backoff + jitter.
										attempt++;
										logger.error(
											{ err, mailboxPath, attempt },
											`Bulk source fetch failed on attempt ${attempt}`
										);
										if (attempt >= maxRetries) {
											logger.error(
												{ err, mailboxPath },
												'Bulk source fetch failed after all retries.'
											);
											throw err;
										}
										const delay = Math.pow(2, attempt) * 1000;
										const jitter = Math.random() * 1000;
										logger.info(
											`Retrying bulk fetch in ${Math.round(
												(delay + jitter) / 1000
											)}s`
										);
										await new Promise((resolve) =>
											setTimeout(resolve, delay + jitter)
										);
										continue;
									}

									// Stream drained without a network error. A parseMessage
									// failure is fatal for the mailbox (matches prior behavior).
									if (parseError) {
										logger.error(
											{ err: parseError, mailboxPath },
											'Failed to parse message'
										);
										throw parseError;
									}
									break;
								}
							}

							// This batch is fully scanned and its non-duplicate bodies have
							// all been yielded: advance the checkpointable high-water mark to
							// the batch's upper bound. Every UID <= endUid is now either
							// yielded for archival or a confirmed duplicate, so a mid-job
							// checkpoint of this value is safe (once the consumer has drained
							// its in-flight archival work).
							this.newMaxUids[mailboxPath] = endUid;

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
