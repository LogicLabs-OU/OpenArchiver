import type {
	JmapCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector, ConnectorOptions } from '../EmailProviderFactory';
import { findByEmailKey, normalizeEmailAddress } from '../../helpers/emailAddress';
import { simpleParser, ParsedMail, Attachment, AddressObject } from 'mailparser';
import { config } from '../../config';
import { logger } from '../../config/logger';
import { getThreadId } from './helpers/utils';
import { sentDateOf } from './helpers/sentDate';
import { writeEmailToTempFile } from './helpers/tempFile';
import {
	isRetryableStatus,
	isTransportError,
	MessageFailureTally,
	SkippedMessageRegister,
	withRetry,
} from './helpers/retry';
import {
	JmapAuthError,
	JmapBlobMissingError,
	JmapClient,
	JmapError,
	JmapMethodError,
	type JmapInvocation,
} from './helpers/jmapClient';

/** Ids per Email/query page, Email/changes page and Email/get call, capped by the server's own limit. */
const PAGE_SIZE = 500;

/** The Email properties the archiver reads; the message itself comes from the blob. */
const EMAIL_PROPERTIES = ['id', 'blobId', 'receivedAt', 'messageId', 'mailboxIds', 'keywords'];

interface JmapMailbox {
	id: string;
	name: string;
	parentId: string | null;
	role: string | null;
}

interface JmapEmail {
	id: string;
	blobId: string;
	receivedAt?: string;
	messageId?: string[] | null;
	mailboxIds: Record<string, boolean>;
	keywords?: Record<string, boolean>;
}

/**
 * Worth another attempt: a dropped connection, a timeout, a throttle or server fault, or a method
 * the server says it could not run right now. A refused credential and a deleted blob are final.
 */
const isRetryableJmapError = (error: unknown): boolean => {
	if (error instanceof JmapAuthError || error instanceof JmapBlobMissingError) {
		return false;
	}
	if (error instanceof JmapMethodError) {
		return error.type === 'serverUnavailable' || error.type === 'serverFail';
	}
	return isTransportError(error) || isRetryableStatus((error as JmapError)?.status);
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Checks a JMAP source's settings before the connection test, so a typo gets a message naming
 * the field rather than a network error. Plain http is accepted only for a server on this machine,
 * since the credential travels with every request.
 */
export const validateJmapConfig = (
	cfg: Record<string, any>
): { ok: true } | { ok: false; message: string } => {
	let url: URL;
	try {
		url = new URL(String(cfg.serverUrl ?? '').trim());
	} catch {
		return { ok: false, message: 'The JMAP server URL is not a valid URL.' };
	}
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
		return { ok: false, message: 'The JMAP server URL must start with https://.' };
	}
	if (!String(cfg.username ?? '').trim()) {
		return { ok: false, message: 'A username is required for a JMAP source.' };
	}
	if (cfg.authMethod === 'token') {
		return cfg.token ? { ok: true } : { ok: false, message: 'An API token is required.' };
	}
	if (cfg.authMethod === 'password') {
		return cfg.password ? { ok: true } : { ok: false, message: 'A password is required.' };
	}
	return { ok: false, message: 'Choose token or password authentication for the JMAP source.' };
};

/**
 * One mailbox on a JMAP server (RFC 8620 / RFC 8621): Fastmail, Stalwart and others.
 *
 * Mirrors the IMAP connector's folder rules, keyed on JMAP mailbox roles instead of IMAP
 * special-use flags, and the Gmail connector's handling of provider ids and per-message failures.
 * The first run lists every message; later runs ask the server what changed since the state
 * stored after the previous run, so a cycle costs requests in proportion to new mail.
 */
export class JmapConnector implements IEmailConnector {
	private client: JmapClient;
	private options: ConnectorOptions;
	private failures = new MessageFailureTally();
	private skipped = new SkippedMessageRegister();
	private newState: string | null = null;

	constructor(
		private credentials: JmapCredentials,
		options?: ConnectorOptions
	) {
		this.options = options ?? { preserveOriginalFile: false };
		const authorization =
			credentials.authMethod === 'password'
				? `Basic ${Buffer.from(`${credentials.username}:${credentials.password ?? ''}`).toString('base64')}`
				: `Bearer ${credentials.token ?? ''}`;
		this.client = new JmapClient({ serverUrl: credentials.serverUrl, authorization });
	}

	private retry<T>(action: () => Promise<T>, context: Record<string, unknown>): Promise<T> {
		return withRetry(action, isRetryableJmapError, { provider: 'jmap', ...context });
	}

	private async call(
		methodCalls: JmapInvocation[],
		context: Record<string, unknown>
	): Promise<Record<string, Record<string, any>>> {
		return this.retry(() => this.client.call(methodCalls), context);
	}

	public async testConnection(): Promise<boolean> {
		try {
			const { accountId } = await this.retry(() => this.client.session(), {
				call: 'session',
			});
			await this.call([['Mailbox/get', { accountId, ids: null, properties: ['id'] }, '0']], {
				call: 'Mailbox/get',
			});
			return true;
		} catch (error) {
			logger.error({ err: error }, 'Failed to verify JMAP connection');
			throw error;
		}
	}

	/** A JMAP source archives the one mailbox its credential belongs to. */
	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		const email = this.returnImapUserEmail();
		yield { id: '0', primaryEmail: email, displayName: email };
	}

	public returnImapUserEmail(): string {
		return normalizeEmailAddress(this.credentials.username);
	}

	/**
	 * Every mailbox with its full path, joined through `parentId` the way IMAP paths are, and the
	 * ids of those whose mail is left out: Drafts unless ARCHIVE_DRAFTS is set, and Junk and Trash
	 * unless ALL_INCLUSIVE_ARCHIVE is. The rules match the IMAP connector's, keyed on roles.
	 */
	private async loadMailboxes(
		accountId: string
	): Promise<{ paths: Map<string, string>; skipped: Set<string> }> {
		const result = await this.call(
			[
				[
					'Mailbox/get',
					{ accountId, ids: null, properties: ['id', 'name', 'parentId', 'role'] },
					'0',
				],
			],
			{ call: 'Mailbox/get' }
		);
		const list = (result['0']?.list ?? []) as JmapMailbox[];
		const byId = new Map(list.map((mailbox) => [mailbox.id, mailbox]));

		const pathOf = (mailbox: JmapMailbox): string => {
			const names = [mailbox.name];
			const seen = new Set([mailbox.id]);
			let parent = mailbox.parentId ? byId.get(mailbox.parentId) : undefined;
			while (parent && !seen.has(parent.id)) {
				names.unshift(parent.name);
				seen.add(parent.id);
				parent = parent.parentId ? byId.get(parent.parentId) : undefined;
			}
			return names.join('/');
		};

		const paths = new Map<string, string>();
		const skipped = new Set<string>();
		for (const mailbox of list) {
			paths.set(mailbox.id, pathOf(mailbox));
			const role = mailbox.role?.toLowerCase();
			if (role === 'drafts' && !config.ingestion.archiveDrafts) {
				skipped.add(mailbox.id);
			} else if (!config.app.allInclusiveArchive && (role === 'junk' || role === 'trash')) {
				skipped.add(mailbox.id);
			}
		}
		return { paths, skipped };
	}

	public async *fetchEmails(
		userEmail: string,
		syncState?: SyncState | null,
		checkDuplicate?: (messageId: string, internetMessageId?: string) => Promise<boolean>
	): AsyncGenerator<EmailObject | null> {
		const { accountId, maxObjectsInGet } = await this.retry(() => this.client.session(), {
			call: 'session',
			userEmail,
		});
		const pageSize = Math.max(1, Math.min(PAGE_SIZE, maxObjectsInGet));
		const mailboxes = await this.loadMailboxes(accountId);
		const storedState = findByEmailKey(syncState?.jmap, userEmail)?.state;

		if (storedState) {
			try {
				yield* this.fetchChanges(
					accountId,
					storedState,
					pageSize,
					mailboxes,
					userEmail,
					checkDuplicate
				);
				return;
			} catch (error) {
				// The server no longer keeps that state (RFC 8620 §5.2: kept at least 30 days
				// only). Listing everything again is safe: the duplicate check skips what is
				// already archived before anything is downloaded.
				if (
					!(error instanceof JmapMethodError) ||
					error.type !== 'cannotCalculateChanges'
				) {
					throw error;
				}
				logger.warn(
					{ userEmail },
					'JMAP server cannot report changes since the stored state, listing the whole mailbox'
				);
			}
		}

		yield* this.fetchAll(accountId, pageSize, mailboxes, userEmail, checkDuplicate);
	}

	/** Later runs: every message created or updated since the stored state, page by page. */
	private async *fetchChanges(
		accountId: string,
		sinceState: string,
		pageSize: number,
		mailboxes: { paths: Map<string, string>; skipped: Set<string> },
		userEmail: string,
		checkDuplicate?: (messageId: string, internetMessageId?: string) => Promise<boolean>
	): AsyncGenerator<EmailObject | null> {
		let state = sinceState;
		for (;;) {
			const result = await this.call(
				[['Email/changes', { accountId, sinceState: state, maxChanges: pageSize }, '0']],
				{ call: 'Email/changes', userEmail }
			);
			const changes = result['0'];
			// Updated as well as created: moving a message out of Junk or Trash is an update, and
			// that is when it becomes archivable. Destroyed ids are ignored; the archive keeps them.
			const ids = [...(changes.created ?? []), ...(changes.updated ?? [])] as string[];
			yield* this.fetchByIds(accountId, ids, pageSize, mailboxes, userEmail, checkDuplicate);
			state = changes.newState;
			this.newState = state;
			if (!changes.hasMoreChanges) {
				return;
			}
		}
	}

	/**
	 * The first run: every message outside the skipped mailboxes, oldest first.
	 *
	 * The state is read before listing starts, the way the Gmail connector reads its history id, so
	 * mail that arrives during a long first import is reported as a change on the next run. Pages
	 * are fetched by anchor rather than by position, so a message deleted mid-import does not shift
	 * the next page past one that was never seen.
	 */
	private async *fetchAll(
		accountId: string,
		pageSize: number,
		mailboxes: { paths: Map<string, string>; skipped: Set<string> },
		userEmail: string,
		checkDuplicate?: (messageId: string, internetMessageId?: string) => Promise<boolean>
	): AsyncGenerator<EmailObject | null> {
		const initial = await this.call([['Email/get', { accountId, ids: [] }, '0']], {
			call: 'Email/get',
			userEmail,
		});
		const startState = initial['0'].state as string;

		const filter =
			mailboxes.skipped.size > 0 ? { inMailboxOtherThan: [...mailboxes.skipped] } : undefined;
		let anchor: string | null = null;
		let listed = 0;

		for (;;) {
			const page: Record<string, unknown> = anchor
				? { anchor, anchorOffset: 1 }
				: { position: listed };
			let ids: string[];
			try {
				const result = await this.call(
					[
						[
							'Email/query',
							{
								accountId,
								filter,
								sort: [{ property: 'receivedAt', isAscending: true }],
								limit: pageSize,
								...page,
							},
							'0',
						],
					],
					{ call: 'Email/query', userEmail }
				);
				ids = result['0'].ids ?? [];
			} catch (error) {
				// The anchor itself was deleted. Continuing by position may revisit a few
				// messages, which the duplicate check then skips without downloading them.
				if (error instanceof JmapMethodError && error.type === 'anchorNotFound') {
					anchor = null;
					continue;
				}
				throw error;
			}

			yield* this.fetchByIds(accountId, ids, pageSize, mailboxes, userEmail, checkDuplicate);
			listed += ids.length;
			// Only an empty page ends the listing. A short one proves nothing: the server may
			// clamp `limit` to a cap it never advertises (RFC 8620 §5.5), and treating that first
			// short page as the last would store the state with most of the mailbox never listed.
			if (ids.length === 0) {
				break;
			}
			anchor = ids[ids.length - 1];
		}

		this.newState = startState;
	}

	/** Reads the metadata for a list of ids and yields each message worth archiving. */
	private async *fetchByIds(
		accountId: string,
		ids: string[],
		pageSize: number,
		mailboxes: { paths: Map<string, string>; skipped: Set<string> },
		userEmail: string,
		checkDuplicate?: (messageId: string, internetMessageId?: string) => Promise<boolean>
	): AsyncGenerator<EmailObject | null> {
		for (let i = 0; i < ids.length; i += pageSize) {
			const result = await this.call(
				[
					[
						'Email/get',
						{
							accountId,
							ids: ids.slice(i, i + pageSize),
							properties: EMAIL_PROPERTIES,
						},
						'0',
					],
				],
				{ call: 'Email/get', userEmail }
			);

			for (const email of (result['0'].list ?? []) as JmapEmail[]) {
				// A message can sit in several mailboxes. It is archived when any of them is
				// archived, under the first one's path; the others become tags.
				const kept = Object.keys(email.mailboxIds ?? {})
					.filter((id) => !mailboxes.skipped.has(id))
					.map((id) => mailboxes.paths.get(id))
					.filter((path): path is string => path !== undefined);
				if (kept.length === 0) {
					continue;
				}
				const isDraft = email.keywords?.$draft === true;
				if (isDraft && !config.ingestion.archiveDrafts) {
					continue;
				}
				if (checkDuplicate && (await checkDuplicate(email.id, email.messageId?.[0]))) {
					continue;
				}
				yield await this.fetchMessageOrSkip(email, kept, isDraft, userEmail);
			}
		}
	}

	/**
	 * Downloads and parses one message, or records why it could not be.
	 *
	 * A blob that is gone was deleted after being listed, which the next run cannot fix either, so
	 * it is registered as skipped rather than failed. Anything else has used its retries and is
	 * counted, so the mailbox job discards this run's state and the message is tried again. The
	 * tally is touched outside the try, as in the Gmail connector: its own throw must not be
	 * caught and counted a second time.
	 */
	private async fetchMessageOrSkip(
		email: JmapEmail,
		paths: string[],
		isDraft: boolean,
		userEmail: string
	): Promise<EmailObject | null> {
		let message: EmailObject | null = null;
		let failure: unknown;
		try {
			const raw = await this.retry(
				() => this.client.downloadBlob(email.blobId, `${email.id}.eml`),
				{ call: 'download', emailId: email.id, userEmail }
			);
			message = await this.parseRawEmail(raw, email, paths, isDraft, userEmail);
		} catch (error) {
			failure = error;
		}

		if (failure === undefined) {
			this.failures.succeeded();
			return message;
		}
		if (failure instanceof JmapBlobMissingError) {
			logger.warn(
				{ emailId: email.id, userEmail },
				'JMAP message no longer exists, skipping.'
			);
			this.skipped.record(email.id);
			this.failures.succeeded();
			return null;
		}
		if (failure instanceof JmapAuthError) {
			throw failure;
		}
		logger.error(
			{ err: failure, emailId: email.id, userEmail },
			'Giving up on message after retries, skipping it and continuing with the mailbox.'
		);
		this.failures.record(email.id, failure);
		return null;
	}

	private async parseRawEmail(
		rawEmail: Buffer,
		email: JmapEmail,
		paths: string[],
		isDraft: boolean,
		userEmail: string
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

		const [path, ...tags] = paths;

		// Written last, once nothing left can throw. Only IngestionService.processEmail deletes
		// this file, and it never sees a message that failed on the way here.
		const tempFilePath = await writeEmailToTempFile(rawEmail);

		return {
			id: email.id,
			threadId: getThreadId(parsedEmail.headers),
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
			receivedAt: sentDateOf(parsedEmail, email.receivedAt),
			path,
			tags: tags.length > 0 ? tags : undefined,
			isDraft: isDraft || undefined,
		};
	}

	public getUpdatedSyncState(userEmail: string): SyncState {
		if (!this.newState) {
			return {};
		}
		return { jmap: { [userEmail]: { state: this.newState } } };
	}

	/** Messages this connector gave up on after retries, for the mailbox job to report. */
	public getFetchFailures(): { count: number; samples: string[] } {
		return this.failures.result;
	}

	/** Messages that were deleted between being listed and being downloaded. */
	public getSkippedMessages(): { count: number; samples: string[] } {
		return this.skipped.result;
	}
}
