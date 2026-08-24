import 'cross-fetch/polyfill';
import type {
	Microsoft365Credentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector, ConnectorOptions } from '../EmailProviderFactory';
import { findByEmailKey } from '../../helpers/emailAddress';
import { logger } from '../../config/logger';
import { simpleParser, ParsedMail, Attachment, AddressObject } from 'mailparser';
import { writeEmailToTempFile } from './helpers/tempFile';
import { ConfidentialClientApplication, Configuration, LogLevel } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';
import type { User, MailFolder } from 'microsoft-graph';
import type { AuthProvider } from '@microsoft/microsoft-graph-client';
import {
	isRetryableStatus,
	isTransportError,
	MessageFailureTally,
	REQUEST_TIMEOUT_MS,
	withRetry,
} from './helpers/retry';
import { TimeboundMsalNetworkClient } from './helpers/msalNetworkClient';

/** The HTTP status behind a Graph failure. `GraphError` carries it on `statusCode`. */
const statusOf = (error: any): number | undefined =>
	typeof error?.statusCode === 'number' ? error.statusCode : undefined;

/**
 * Whether a Graph failure is worth another attempt. A 410 is deliberately absent — that is an
 * expired delta token, which needs a resync rather than a repeat of the same request.
 *
 * The client's own retry handler is narrower than it looks: it decides from `context.response` and
 * calls the next middleware outside any `try`, so a request that never produced a response skips it
 * entirely. Those arrive here as a `GraphError` carrying the `-1` status
 * `GraphErrorHandler.getError` defaults to, with `code` set from the error's name rather than an
 * errno, so the status is the only signal left to read. Retrying them is what keeps one connection
 * reset from costing a message or a whole folder.
 */
const isRetryableGraphError = (error: unknown): boolean => {
	const status = statusOf(error);
	if (status === undefined) {
		// Not a GraphError. `getStream` resolves once the headers arrive, so everything thrown while
		// the body is being consumed — a reset connection, or the deadline firing mid-download —
		// escapes the client untouched and reaches here in its original shape.
		return isTransportError(error);
	}
	if (status === -1) return true;
	return isRetryableStatus(status);
};

/**
 * Whether Graph is telling us the stored delta token no longer resolves. Continuing to send it
 * would fail on every cycle forever, so the folder has to restart from a full delta query.
 */
const isDeltaTokenExpired = (error: unknown): boolean =>
	statusOf(error) === 410 ||
	['resyncRequired', 'syncStateNotFound', 'syncStateInvalid'].includes(
		String((error as any)?.code ?? '')
	);

/**
 * Whether Graph is saying this directory entry has no mailbox to read, rather than that
 * something went wrong reading it.
 *
 * A tenant's `/users` collection is a directory, not a mailbox list: Entra ID guests (`#EXT#`
 * UPNs, invited to Teams or SharePoint) and members without an Exchange licence appear there
 * and own nothing to archive. Asking for their mail is answered with one of these codes on
 * every cycle, forever — no retry, permission change or resync alters it, because the mailbox
 * does not exist.
 *
 * `MailboxNotEnabledForRESTAPI` is the licensed-but-mailbox-less answer; the ResourceNotFound
 * family is what a guest gets, since the object is not resolvable as a mail user at all.
 * Distinguishing them from real failures is what lets a cycle whose only "errors" are these
 * finish as a success instead of parking the source in `error` for the scheduler to retry
 * every tick (#351).
 *
 * Deliberately narrow. A 403 (missing Mail.Read, unconsented app) is a real misconfiguration
 * and must keep failing loudly, so status alone is never enough to land here.
 */
export const isMailboxUnavailableError = (error: unknown): boolean => {
	const code = String((error as any)?.code ?? '');
	if (
		[
			'MailboxNotEnabledForRESTAPI',
			'ResourceNotFound',
			'Request_ResourceNotFound',
			'ErrorInvalidUser',
		].includes(code)
	) {
		return true;
	}
	// Some of these arrive as a 404 whose code sits in the nested body rather than on the
	// GraphError itself, so the message is the only place the reason survives.
	if (statusOf(error) !== 404) {
		return false;
	}
	const message = String((error as any)?.message ?? '');
	return (
		/MailboxNotEnabledForRESTAPI/i.test(message) ||
		/does not exist or one of its queried reference-property objects are not present/i.test(
			message
		)
	);
};

/**
 * A connector for Microsoft 365 that uses the Microsoft Graph API with client credentials (app-only)
 * to access data on behalf of the organization.
 */
export class MicrosoftConnector implements IEmailConnector {
	private credentials: Microsoft365Credentials | null;
	protected graphClient: Client;
	// Store delta tokens for each folder during a sync operation.
	private newDeltaTokens: { [folderId: string]: string };
	protected options: ConnectorOptions;
	/** Messages skipped so the rest of the mailbox could finish. One connector serves one mailbox. */
	private failures = new MessageFailureTally();

	/**
	 * @param credentials Tenant credentials for the app-only flow. Null when `authProvider`
	 *   is supplied, because a delegated caller authenticates as a user and has no tenant
	 *   client secret to offer.
	 * @param authProvider Overrides how a Graph token is obtained. A delegated subclass passes
	 *   its own here; everything downstream — delta sync, folder walk, raw MIME — is unaware
	 *   of which one was used.
	 */
	constructor(
		credentials: Microsoft365Credentials | null,
		options?: ConnectorOptions,
		authProvider?: AuthProvider
	) {
		this.credentials = credentials;
		this.options = options ?? { preserveOriginalFile: false };
		this.newDeltaTokens = {}; // Initialize as an empty object

		this.graphClient = Client.init({
			authProvider: authProvider ?? this.createAppOnlyAuthProvider(),
		});
	}

	/**
	 * The app-only token source: one client-credentials grant for the whole tenant.
	 *
	 * Private rather than protected on purpose. It runs from the constructor, where a
	 * subclass override would execute before the subclass's own fields exist — a delegated
	 * connector supplies its provider through the constructor argument instead.
	 */
	private createAppOnlyAuthProvider(): AuthProvider {
		const credentials = this.credentials;
		if (!credentials) {
			throw new Error('Microsoft 365 credentials are required for app-only Graph access.');
		}

		const msalConfig: Configuration = {
			auth: {
				clientId: credentials.clientId,
				authority: `https://login.microsoftonline.com/${credentials.tenantId}`,
				clientSecret: credentials.clientSecret,
			},
			system: {
				loggerOptions: {
					loggerCallback(loglevel, message, containsPii) {
						if (containsPii) return;
						switch (loglevel) {
							case LogLevel.Error:
								logger.error(message);
								return;
							case LogLevel.Warning:
								logger.warn(message);
								return;
							case LogLevel.Info:
								logger.info(message);
								return;
							case LogLevel.Verbose:
								logger.debug(message);
								return;
						}
					},
					piiLoggingEnabled: false,
					logLevel: LogLevel.Warning,
				},
				// MSAL's own client leaves POSTs — which is what token acquisition is — with no
				// timeout at all, so this is what keeps a quiet login endpoint from parking the
				// mailbox job forever. The per-request signal in `request()` does not reach here:
				// token acquisition happens inside the auth provider, on MSAL's own transport.
				networkClient: new TimeboundMsalNetworkClient(),
			},
		};

		const msalClient = new ConfidentialClientApplication(msalConfig);

		return async (done) => {
			try {
				const response = await msalClient.acquireTokenByClientCredential({
					scopes: ['https://graph.microsoft.com/.default'],
				});
				if (!response?.accessToken) {
					throw new Error('Failed to acquire access token.');
				}
				done(null, response.accessToken);
			} catch (error) {
				logger.error({ err: error }, 'Failed to acquire Microsoft Graph access token');
				done(error, null);
			}
		};
	}

	/**
	 * Starts a Graph request with a deadline attached.
	 *
	 * The Graph client sets no timeout of its own, so a socket that never answers would leave a
	 * mailbox job awaiting forever — see REQUEST_TIMEOUT_MS. The signal has to be built per request:
	 * one shared signal passed through `Client.init`'s `fetchOptions` would abort every later
	 * request the moment the first deadline elapsed. `option()` lands in the fetch init the client
	 * passes straight through, and an abort arrives back as a `GraphError` with the `-1` status
	 * `isRetryableGraphError` already retries.
	 */
	protected request(url: string) {
		return (
			this.graphClient
				.api(url)
				// Immutable ids for every Outlook item this request returns. Regular Graph ids
				// change when a message is moved between folders, which silently rots every
				// stored provider_message_id; immutable ids survive folder moves (#428). The
				// header must accompany EVERY request for the id format to be consistent, and
				// this method is the one path every Graph call takes — which is what makes
				// that guarantee hold. Non-Outlook resources (/users) ignore it, and stored
				// delta tokens are documented as compatible with both formats, so no source
				// has to resync when this ships.
				.header('Prefer', 'IdType="ImmutableId"')
				.option('signal', AbortSignal.timeout(REQUEST_TIMEOUT_MS))
		);
	}

	/**
	 * The Graph path prefix for one mailbox. Every mailbox-scoped request goes through this
	 * rather than templating `/users/...` inline, because a delegated connector addresses the
	 * signed-in mailbox as `/me` and has no permission to name it any other way. Overriding
	 * this one method is what lets the delta sync, folder walk and raw-MIME fetch below be
	 * shared between the app-only tenant connector and a single-mailbox delegated one.
	 */
	protected mailboxPath(userEmail: string): string {
		// Encoded, because a UPN is not URL-safe. A guest's UPN carries `#EXT#`, and `#` starts
		// the fragment of a URL: interpolated raw, `/users/alice_contoso.com#EXT#@tenant...`
		// reaches Graph as `/users/alice_contoso.com`, which is a different (usually absent)
		// user. That is the origin of the "Resource 'x' does not exist" wording in #351 — the
		// name Graph reports back is the truncated half, not the account that was asked for.
		// Every UPN with a reserved character had the same problem.
		return `/users/${encodeURIComponent(userEmail)}`;
	}

	/**
	 * Tests the connection and authentication by attempting to list the first user
	 * from the directory.
	 */
	public async testConnection(): Promise<boolean> {
		try {
			await this.request('/users').top(1).get();
			logger.info('Microsoft 365 connection test successful.');
			return true;
		} catch (error) {
			logger.error({ err: error }, 'Failed to verify Microsoft 365 connection');
			throw error;
		}
	}

	/**
	 * Lists the tenant's mail-owning users.
	 *
	 * `/users` is a directory rather than a mailbox list, so it also returns Entra ID guests —
	 * external people invited to Teams or SharePoint, who hold no Exchange mailbox. Archiving
	 * has nothing to fetch for them, and asking anyway failed every cycle and kept the source
	 * in `error` permanently (#351). Guests are dropped here, at the one place that decides
	 * what a cycle will even attempt.
	 *
	 * Filtered in code rather than with `$filter=userType eq 'Member'`: `userType` is not
	 * filterable on a plain request, so that query needs `$count=true` plus the
	 * `ConsistencyLevel: eventual` header, and without them Graph answers 400 and the source
	 * lists nothing at all. Adding `userType` to `$select` costs nothing and cannot fail.
	 *
	 * Members without a mailbox (no Exchange licence) still get through — nothing in the
	 * directory marks them — and are handled where they surface, by isMailboxUnavailableError.
	 *
	 * @returns An async generator that yields each mail-owning user.
	 */
	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		let request = this.request('/users').select('id,userPrincipalName,displayName,userType');
		let skippedGuests = 0;

		try {
			let response = await request.get();
			while (response) {
				for (const user of response.value as User[]) {
					// Compared case-insensitively; Graph documents 'Guest' but the value is
					// data, not a contract, and a null userType (rare, directory-synced
					// objects) must not be mistaken for one.
					if (String(user.userType ?? '').toLowerCase() === 'guest') {
						skippedGuests++;
						continue;
					}
					if (user.id && user.userPrincipalName && user.displayName) {
						yield {
							id: user.id,
							primaryEmail: user.userPrincipalName,
							displayName: user.displayName,
						};
					}
				}

				if (response['@odata.nextLink']) {
					response = await this.request(response['@odata.nextLink']).get();
				} else {
					break;
				}
			}

			// One line per cycle, not one per guest: a tenant can hold hundreds, and the
			// operator only needs to know the omission happened and how large it was.
			if (skippedGuests > 0) {
				logger.info(
					{ skippedGuests },
					'Skipped Entra ID guest users while listing mailboxes; guests hold no mailbox to archive'
				);
			}
		} catch (error) {
			logger.error({ err: error }, 'Failed to list all users from Microsoft 365');
			throw error;
		}
	}

	/**
	 * Fetches emails for a single user by iterating through all mail folders and
	 * performing a delta query on each.
	 * @param userEmail The user principal name or ID of the user.
	 * @param syncState Optional state containing the deltaTokens for each folder.
	 * @returns An async generator that yields each raw email object.
	 */
	public async *fetchEmails(
		userEmail: string,
		syncState?: SyncState | null,
		checkDuplicate?: (messageId: string, internetMessageId?: string) => Promise<boolean>
	): AsyncGenerator<EmailObject> {
		// Looked up case-insensitively: the key was written from the user principal name, whose
		// casing Graph reports as it was created, while `userEmail` now arrives normalized. A plain
		// index would miss every pre-existing entry and restart the delta query for every folder.
		this.newDeltaTokens = findByEmailKey(syncState?.microsoft, userEmail)?.deltaTokens || {};

		try {
			const folders = this.listAllFolders(userEmail);
			for await (const folder of folders) {
				if (folder.id && folder.path) {
					logger.info(
						{ userEmail, folderId: folder.id, folderName: folder.displayName },
						'Syncing folder'
					);
					yield* this.syncFolder(
						userEmail,
						folder.id,
						folder.path,
						this.newDeltaTokens[folder.id],
						checkDuplicate
					);
				}
			}
		} catch (error) {
			logger.error({ err: error, userEmail }, 'Failed to fetch emails from Microsoft 365');
			throw error;
		}
	}

	/**
	 * Lists all mail folders for a given user.
	 * @param userEmail The user principal name or ID.
	 * @returns An async generator that yields each mail folder.
	 */
	/**
	 * Translates regular ("restId") Graph message ids to their immutable form, up to 1000 per
	 * call, for the provider-id backfill job. Returns a map of sourceId → targetId containing
	 * only the ids Graph could resolve; ids that no longer resolve (message deleted, id already
	 * immutable) are simply absent, and a whole-batch rejection comes back as an empty map —
	 * the backfill treats anything unresolved as "leave the row alone", so this method never
	 * needs to fail hard.
	 */
	public async translateIds(userEmail: string, ids: string[]): Promise<Map<string, string>> {
		const translated = new Map<string, string>();
		if (ids.length === 0) {
			return translated;
		}
		try {
			const response = await withRetry(
				() =>
					this.request(`${this.mailboxPath(userEmail)}/translateExchangeIds`).post({
						inputIds: ids,
						sourceIdType: 'restId',
						targetIdType: 'restImmutableEntryId',
					}),
				isRetryableGraphError,
				{ userEmail, call: 'translateExchangeIds' }
			);
			for (const entry of response?.value ?? []) {
				if (typeof entry?.sourceId === 'string' && typeof entry?.targetId === 'string') {
					translated.set(entry.sourceId, entry.targetId);
				}
			}
		} catch (error) {
			logger.warn(
				{ err: error, userEmail, batchSize: ids.length },
				'translateExchangeIds batch failed; leaving these rows on their stored ids'
			);
		}
		return translated;
	}

	private async *listAllFolders(
		userEmail: string,
		parentFolderId?: string,
		currentPath = ''
	): AsyncGenerator<MailFolder & { path: string }> {
		const mailbox = this.mailboxPath(userEmail);
		const requestUrl = parentFolderId
			? `${mailbox}/mailFolders/${parentFolderId}/childFolders`
			: `${mailbox}/mailFolders`;

		try {
			let response = await withRetry(
				() => this.request(requestUrl).get(),
				isRetryableGraphError,
				{ userEmail, call: 'mailFolders' }
			);

			while (response) {
				for (const folder of response.value as MailFolder[]) {
					const newPath = currentPath
						? `${currentPath}/${folder.displayName || ''}`
						: folder.displayName || '';
					yield { ...folder, path: newPath || '' };

					if (folder.childFolderCount && folder.childFolderCount > 0) {
						yield* this.listAllFolders(userEmail, folder.id, newPath);
					}
				}

				if (response['@odata.nextLink']) {
					const nextLink = response['@odata.nextLink'];
					response = await withRetry(
						() => this.request(nextLink).get(),
						isRetryableGraphError,
						{ userEmail, call: 'mailFolders(next)' }
					);
				} else {
					break;
				}
			}
		} catch (error) {
			logger.error({ err: error, userEmail }, 'Failed to list mail folders');
			throw error;
		}
	}

	/**
	 * Performs a delta sync on a single mail folder.
	 * @param userEmail The user's email.
	 * @param folderId The ID of the folder to sync.
	 * @param deltaToken The existing delta token for this folder, if any.
	 * @returns An async generator that yields email objects.
	 */
	private async *syncFolder(
		userEmail: string,
		folderId: string,
		path: string,
		deltaToken?: string,
		checkDuplicate?: (messageId: string, internetMessageId?: string) => Promise<boolean>
	): AsyncGenerator<EmailObject> {
		const initialUrl = `${this.mailboxPath(userEmail)}/mailFolders/${folderId}/messages/delta`;
		let requestUrl: string | undefined = deltaToken || initialUrl;
		let hasResynced = false;

		while (requestUrl) {
			let response: any;
			try {
				response = await withRetry(
					// isDraft rides along with the delta response, so no extra request is needed to
					// tell an unsent draft from a real message. internetMessageId is the RFC
					// Message-ID, carried for the dedup pre-check: it is the key that still
					// matches when the stored provider id is NULL (pre-migration rows) or stale
					// (id re-keyed). A deltaLink minted before this select was added keeps its
					// old field list until the folder rebuilds from initialUrl, so the field is
					// treated as optional everywhere it is read.
					() =>
						this.request(requestUrl!)
							.select('id,conversationId,isDraft,internetMessageId')
							.get(),
					isRetryableGraphError,
					{ userEmail, folderId, call: 'messages/delta' }
				);
			} catch (error) {
				// Graph expires delta tokens, and the stored one is sent again on every cycle, so
				// an expired token means the folder stops syncing permanently unless it restarts
				// from a full delta query. Attempted once, so a genuine 410 on the fresh query
				// is not retried in a loop.
				if (!hasResynced && isDeltaTokenExpired(error)) {
					hasResynced = true;
					delete this.newDeltaTokens[folderId];
					logger.warn(
						{ userEmail, folderId },
						'Delta token for this folder is no longer valid, restarting the folder from a full sync.'
					);
					requestUrl = initialUrl;
					continue;
				}
				logger.error(
					{ err: error, userEmail, folderId },
					'Failed to sync mail folder, skipping the rest of it.'
				);
				// Counted so the mailbox reports the gap rather than finishing as a clean success.
				// It is one entry standing for however many messages the folder still held, so the
				// sample says so — the count alone would read as a single lost message.
				this.failures.record(
					`folder ${path} abandoned, remaining messages not fetched`,
					error
				);
				return;
			}

			for (const message of response.value) {
				if (message.id && !message['@removed']) {
					// Skip fetching raw content for already-imported messages
					if (
						checkDuplicate &&
						(await checkDuplicate(message.id, message.internetMessageId ?? undefined))
					) {
						logger.debug(
							{ messageId: message.id, userEmail },
							'Skipping duplicate email (pre-check)'
						);
						continue;
					}

					const emailObject = await this.fetchMessageOrSkip(userEmail, message.id, path);
					if (emailObject) {
						emailObject.threadId = message.conversationId;
						// Marked rather than dropped here, so what happens to drafts is decided in
						// one place — see the draft handling in process-mailbox.processor.
						emailObject.isDraft = message.isDraft === true || undefined;
						yield emailObject;
					}
				}
			}

			if (response['@odata.deltaLink']) {
				this.newDeltaTokens[folderId] = response['@odata.deltaLink'];
			}

			requestUrl = response['@odata.nextLink'];
		}
	}

	/**
	 * Decides what one message's failure costs.
	 *
	 * A 404 means the message was deleted between the delta query and the fetch, so it is skipped
	 * without counting against the mailbox. Anything else has already used up its retries; it is
	 * counted and skipped so the remaining messages still reach the archive. Previously every
	 * failure here was swallowed and the message vanished from the archive with nothing recorded.
	 */
	private async fetchMessageOrSkip(
		userEmail: string,
		messageId: string,
		path: string
	): Promise<EmailObject | null> {
		try {
			const rawEmail = await withRetry(
				() => this.getRawEmail(userEmail, messageId),
				isRetryableGraphError,
				{ userEmail, messageId, call: 'messages/$value' }
			);
			const email = await this.parseEmail(rawEmail, messageId, userEmail, path);
			// Only after parsing. Clearing the run before it would let a failure that repeats on
			// every message — an unwritable temp directory, a full disk — reset the counter it is
			// about to increment, so the brake below could never engage and the whole mailbox
			// would be downloaded and discarded one message at a time.
			this.failures.succeeded();
			return email;
		} catch (error) {
			if (statusOf(error) === 404) {
				logger.warn({ messageId, userEmail }, 'Message not found, skipping.');
				this.failures.succeeded();
				return null;
			}
			logger.error(
				{ err: error, messageId, userEmail },
				'Giving up on message after retries, skipping it and continuing with the mailbox.'
			);
			this.failures.record(messageId, error);
			return null;
		}
	}

	/** Messages this connector skipped, for the mailbox job to report. */
	public getFetchFailures(): { count: number; samples: string[] } {
		return this.failures.result;
	}

	private async getRawEmail(userEmail: string, messageId: string): Promise<Buffer> {
		// The deadline covers the body read too, not just the response headers — an abort tears down
		// the stream, so a download that stalls mid-message fails instead of hanging the job.
		const response = await this.request(
			`${this.mailboxPath(userEmail)}/messages/${messageId}/$value`
		).getStream();
		const chunks: any[] = [];
		for await (const chunk of response) {
			chunks.push(chunk);
		}
		return Buffer.concat(chunks);
	}

	private async parseEmail(
		rawEmail: Buffer,
		messageId: string,
		userEmail: string,
		path: string
	): Promise<EmailObject> {
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

		const from = mapAddresses(parsedEmail.from);
		const to = mapAddresses(parsedEmail.to);
		const cc = mapAddresses(parsedEmail.cc);
		const bcc = mapAddresses(parsedEmail.bcc);

		// Written last, once nothing left can throw. Only IngestionService.processEmail deletes
		// this file, and it never sees a message that failed on the way here, so a file written
		// before a throw stays on disk forever — one full copy of the email per failure, with no
		// sweeper anywhere to collect it.
		const tempFilePath = await writeEmailToTempFile(rawEmail);

		return {
			id: messageId,
			userEmail: userEmail,
			tempFilePath,
			from,
			to,
			cc,
			bcc,
			subject: parsedEmail.subject || '',
			body: parsedEmail.text || '',
			html: parsedEmail.html || '',
			headers: parsedEmail.headers,
			attachments,
			receivedAt: parsedEmail.date || new Date(),
			path,
		};
	}

	public getUpdatedSyncState(userEmail: string): SyncState {
		if (Object.keys(this.newDeltaTokens).length === 0) {
			return {};
		}
		return {
			microsoft: {
				[userEmail]: {
					deltaTokens: this.newDeltaTokens,
				},
			},
		};
	}
}
