import type {
	PSTImportCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector, ConnectorOptions } from '../EmailProviderFactory';
import { PSTFile, PSTFolder, PSTMessage } from 'pst-extractor';
import { simpleParser, ParsedMail, Attachment, AddressObject } from 'mailparser';
import { logger } from '../../config/logger';
import { getThreadId } from './helpers/utils';
import { writeEmailToTempFile } from './helpers/tempFile';
import { StorageService } from '../StorageService';
import { createHash } from 'crypto';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { createWriteStream, createReadStream, promises as fs } from 'fs';

/** Prefix for the temp working copies of remote PSTs. */
const PST_TEMP_PREFIX = 'pst-import-';
/** Sentinel file recording the PID that owns a temp dir, so the sweep can tell a live
 * import's dir from a leaked one instead of relying on age alone. */
const PST_OWNER_FILE = 'owner.pid';
/** Fallback age threshold (ms) for temp dirs with no readable owner sentinel (e.g. left by
 * an older version, or killed before the pid file was written). Dirs with a live owner are
 * never removed regardless of age — a large PST parse can legitimately run for hours while
 * its temp copy's mtime never changes. */
const PST_TEMP_STALE_MS = 6 * 60 * 60 * 1000; // 6 hours

/** True if a process with this PID is currently running. */
function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		// Signal 0 performs error checking without sending a signal.
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// ESRCH = no such process. EPERM = process exists but is owned by another user
		// (still alive, so treat the dir as in-use and keep it).
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

// We have to hardcode names for deleted and trash folders here as current lib doesn't support looking into PST properties.
const DELETED_FOLDERS = new Set([
	// English
	'deleted items',
	'trash',
	// Spanish
	'elementos eliminados',
	'papelera',
	// French
	'éléments supprimés',
	'corbeille',
	// German
	'gelöschte elemente',
	'papierkorb',
	// Italian
	'posta eliminata',
	'cestino',
	// Portuguese
	'itens excluídos',
	'lixo',
	// Dutch
	'verwijderde items',
	'prullenbak',
	// Russian
	'удаленные',
	'корзина',
	// Polish
	'usunięte elementy',
	'kosz',
	// Japanese
	'削除済みアイテム',
	// Czech
	'odstraněná pošta',
	'koš',
	// Estonian
	'kustutatud kirjad',
	'prügikast',
	// Swedish
	'borttagna objekt',
	'skräp',
	// Danish
	'slettet post',
	'papirkurv',
	// Norwegian
	'slettede elementer',
	// Finnish
	'poistetut',
	'roskakori',
]);

const JUNK_FOLDERS = new Set([
	// English
	'junk email',
	'spam',
	// Spanish
	'correo no deseado',
	// French
	'courrier indésirable',
	// German
	'junk-e-mail',
	// Italian
	'posta indesiderata',
	// Portuguese
	'lixo eletrônico',
	// Dutch
	'ongewenste e-mail',
	// Russian
	'нежелательная почта',
	'спам',
	// Polish
	'wiadomości-śmieci',
	// Japanese
	'迷惑メール',
	'スパム',
	// Czech
	'nevyžádaná pošta',
	// Estonian
	'rämpspost',
	// Swedish
	'skräppost',
	// Danish
	'uønsket post',
	// Norwegian
	'søppelpost',
	// Finnish
	'roskaposti',
]);

export class PSTConnector implements IEmailConnector {
	private storage: StorageService;
	private options: ConnectorOptions;
	/**
	 * X.500 DN → SMTP address pairs learned while walking the PST (recipient rows
	 * carry both forms; resolved senders contribute too). Used as a last resort for
	 * senders — typically Sent Items — whose messages carry no SMTP form at all.
	 * Best-effort by nature: a DN can only be resolved after it has been seen once.
	 */
	private dnToSmtp = new Map<string, string>();

	constructor(
		private credentials: PSTImportCredentials,
		options?: ConnectorOptions
	) {
		this.options = options ?? { preserveOriginalFile: false };
		this.storage = new StorageService();
	}

	private getFilePath(): string {
		return this.credentials.localFilePath || this.credentials.uploadedFilePath || '';
	}

	private async getFileStream(): Promise<NodeJS.ReadableStream> {
		if (this.credentials.localFilePath) {
			return createReadStream(this.credentials.localFilePath);
		}
		return this.storage.getStream(this.getFilePath());
	}

	/**
	 * Best-effort removal of temp PST copies left behind by hard-killed prior imports.
	 * A 22 GB PST copy per leak fills the disk quickly, so sweep before creating a new one.
	 *
	 * Ownership-aware: each temp dir records the PID that created it. A dir whose owner is
	 * still alive is left untouched (a large parse can run for hours with an unchanging
	 * mtime, so age alone would wrongly delete an in-use copy). Only dirs whose owner has
	 * died — or that have no owner sentinel and are older than the fallback threshold — are
	 * removed.
	 */
	private async sweepStalePstTempDirs(): Promise<void> {
		const base = tmpdir();
		let entries: string[];
		try {
			entries = await fs.readdir(base);
		} catch {
			return;
		}
		const now = Date.now();
		for (const entry of entries) {
			if (!entry.startsWith(PST_TEMP_PREFIX)) continue;
			const full = join(base, entry);
			try {
				let removable: boolean;
				const owner = await this.readOwnerPid(full);
				if (owner !== null) {
					// Known owner: remove only if that process is gone.
					removable = !isProcessAlive(owner);
				} else {
					// No/unreadable owner sentinel: fall back to age.
					const stat = await fs.stat(full);
					removable = now - stat.mtimeMs > PST_TEMP_STALE_MS;
				}

				if (removable) {
					await fs.rm(full, { recursive: true, force: true });
					logger.info({ dir: full, owner }, 'Removed stale PST temp directory');
				}
			} catch (error) {
				logger.warn({ error, dir: full }, 'Failed to sweep stale PST temp directory');
			}
		}
	}

	/** Reads the owning PID from a temp dir's sentinel, or null if absent/unreadable. */
	private async readOwnerPid(dir: string): Promise<number | null> {
		try {
			const raw = await fs.readFile(join(dir, PST_OWNER_FILE), 'utf-8');
			const pid = Number.parseInt(raw.trim(), 10);
			return Number.isInteger(pid) && pid > 0 ? pid : null;
		} catch {
			return null;
		}
	}

	/**
	 * Opens the PST for reading. When the source is a local path, pst-extractor reads it
	 * directly — no multi-GB copy into tmp (the previous behaviour, which filled the disk
	 * on large PSTs, especially across retries). Only remote/object storage requires
	 * materializing a seekable local copy; `tempDir` is null when none was created.
	 */
	private async loadPstFile(): Promise<{ pstFile: PSTFile; tempDir: string | null }> {
		if (this.credentials.localFilePath) {
			return { pstFile: new PSTFile(this.credentials.localFilePath), tempDir: null };
		}

		await this.sweepStalePstTempDirs();

		const fileStream = await this.getFileStream();
		const tempDir = await fs.mkdtemp(join(tmpdir(), PST_TEMP_PREFIX));
		// Record the owning PID so a concurrent import's sweep can tell this live dir from a
		// leaked one. Best-effort: a failure here only makes the dir fall back to age-based
		// cleanup, so don't fail the import over it.
		await fs
			.writeFile(join(tempDir, PST_OWNER_FILE), String(process.pid), 'utf-8')
			.catch((error) =>
				logger.warn({ error, tempDir }, 'Failed to write PST owner sentinel')
			);
		const tempFilePath = join(tempDir, 'temp.pst');

		await new Promise<void>((resolve, reject) => {
			const dest = createWriteStream(tempFilePath);
			// Surface source-stream errors (e.g. EACCES on a locked/unreadable PST) so they
			// reject this promise and fail the job cleanly — pipe() does not forward source
			// errors to the destination, so without this the 'error' event would be unhandled
			// and crash the worker process.
			fileStream.on('error', reject);
			fileStream.pipe(dest);
			dest.on('finish', resolve);
			dest.on('error', reject);
		});

		const pstFile = new PSTFile(tempFilePath);
		return { pstFile, tempDir };
	}

	public async testConnection(): Promise<boolean> {
		try {
			const filePath = this.getFilePath();
			if (!filePath) {
				throw Error('PST file path not provided.');
			}
			if (!filePath.includes('.pst')) {
				throw Error('Provided file is not in the PST format.');
			}

			let fileExist = false;
			if (this.credentials.localFilePath) {
				try {
					await fs.access(this.credentials.localFilePath);
					fileExist = true;
				} catch {
					fileExist = false;
				}
			} else {
				fileExist = await this.storage.exists(filePath);
			}

			if (!fileExist) {
				if (this.credentials.localFilePath) {
					throw Error(`PST file not found at path: ${this.credentials.localFilePath}`);
				} else {
					throw Error(
						'Uploaded PST file not found. The upload may not have finished yet, or it failed.'
					);
				}
			}
			return true;
		} catch (error) {
			logger.error({ error, credentials: this.credentials }, 'PST file validation failed.');
			throw error;
		}
	}

	/**
	 * Lists mailboxes within the PST. It treats each top-level folder
	 * as a distinct mailbox, allowing it to handle PSTs that have been
	 * consolidated from multiple sources.
	 */
	public async *listAllUsers(): AsyncGenerator<MailboxUser> {
		let pstFile: PSTFile | null = null;
		let tempDir: string | null = null;
		try {
			const loadResult = await this.loadPstFile();
			pstFile = loadResult.pstFile;
			tempDir = loadResult.tempDir;
			const root = pstFile.getRootFolder();
			// The identity constructed here becomes archived_emails.userEmail, which the
			// per-mailbox dedup gate keys on — so it must be STABLE across import runs of
			// the same source. pstFile.pstFilename is the path of the per-run temp copy
			// (random mkdtemp dir) and a timestamp changes every run; both made every
			// re-sync re-archive the entire PST as duplicates. Derive the fallback from
			// the source's own file path instead, which never changes.
			const displayName: string =
				root.displayName ||
				basename(
					this.credentials.localFilePath || this.credentials.uploadedFilePath || ''
				) ||
				'pst-import';
			logger.info(`Found potential mailbox: ${displayName}`);
			// Strip the .pst extension, then: if the result is already an email address —
			// e.g. the file is named after the mailbox it was exported from
			// ("user@example.com.pst") — use it as the identity directly. Only names
			// with no address get the synthetic @pst.local domain appended.
			const normalizedName = displayName
				.replace(/\.pst$/i, '')
				.replace(/\s+/g, '.')
				.toLowerCase();
			const constructedPrimaryEmail = normalizedName.includes('@')
				? normalizedName
				: `${normalizedName}@pst.local`;
			yield {
				id: constructedPrimaryEmail,
				primaryEmail: constructedPrimaryEmail,
				displayName: displayName,
			};
		} catch (error) {
			logger.error({ error }, 'Failed to list users from PST file.');
			throw error;
		} finally {
			pstFile?.close();
			if (tempDir) {
				await fs.rm(tempDir, { recursive: true, force: true });
			}
		}
	}

	public async *fetchEmails(
		userEmail: string,
		syncState?: SyncState | null
	): AsyncGenerator<EmailObject | null> {
		let pstFile: PSTFile | null = null;
		let tempDir: string | null = null;
		try {
			const loadResult = await this.loadPstFile();
			pstFile = loadResult.pstFile;
			tempDir = loadResult.tempDir;
			const root = pstFile.getRootFolder();
			yield* this.processFolder(root, '', userEmail);
		} catch (error) {
			logger.error({ error }, 'Failed to fetch email.');
			throw error;
		} finally {
			pstFile?.close();
			if (tempDir) {
				await fs.rm(tempDir, { recursive: true, force: true });
			}
			if (this.credentials.uploadedFilePath && !this.credentials.localFilePath) {
				try {
					await this.storage.delete(this.credentials.uploadedFilePath);
				} catch (error) {
					logger.error(
						{ error, file: this.credentials.uploadedFilePath },
						'Failed to delete PST file after processing.'
					);
				}
			}
		}
	}

	private async *processFolder(
		folder: PSTFolder,
		currentPath: string,
		userEmail: string
	): AsyncGenerator<EmailObject | null> {
		const folderName = folder.displayName.toLowerCase();
		if (DELETED_FOLDERS.has(folderName) || JUNK_FOLDERS.has(folderName)) {
			logger.info(`Skipping folder: ${folder.displayName}`);
			return;
		}

		const newPath = currentPath ? `${currentPath}/${folder.displayName}` : folder.displayName;

		if (folder.contentCount > 0) {
			let email: PSTMessage | null = folder.getNextChild();
			while (email != null) {
				yield await this.parseMessage(email, newPath, userEmail);
				try {
					email = folder.getNextChild();
				} catch (error) {
					logger.warn(
						{ folder: folder.displayName, error },
						"Folder doesn't have child or failed to read next child."
					);
					email = null;
				}
			}
		}

		if (folder.hasSubfolders) {
			for (const subFolder of folder.getSubFolders()) {
				yield* this.processFolder(subFolder, newPath, userEmail);
			}
		}
	}

	private async parseMessage(
		msg: PSTMessage,
		path: string,
		userEmail: string
	): Promise<EmailObject> {
		const emlContent = await this.constructEml(msg);
		const emlBuffer = Buffer.from(emlContent, 'utf-8');
		const tempFilePath = await writeEmailToTempFile(emlBuffer);
		const parsedEmail: ParsedMail = await simpleParser(emlBuffer);

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
				a.value.map((v) => ({
					name: v.name,
					address: v.address?.replaceAll(`'`, '') || '',
				}))
			);
		};

		const from = mapAddresses(parsedEmail.from);
		if (from.length === 0) {
			from.push({ name: 'No Sender', address: 'No Sender' });
		}

		const threadId = getThreadId(parsedEmail.headers);
		let messageId = msg.internetMessageId;
		// generate a unique ID for this message

		if (!messageId) {
			messageId = `generated-${createHash('sha256')
				.update(
					emlBuffer ?? Buffer.from(parsedEmail.text || parsedEmail.html || '', 'utf-8')
				)
				.digest('hex')}-${createHash('sha256')
				.update(emlBuffer ?? Buffer.from(msg.subject || '', 'utf-8'))
				.digest('hex')}-${msg.clientSubmitTime?.getTime()}`;
		}
		return {
			id: messageId,
			threadId: threadId,
			from,
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
			path,
		};
	}

	private async constructEml(msg: PSTMessage): Promise<string> {
		const CRLF = '\r\n';
		const boundary = '----boundary-openarchiver';
		const altBoundary = '----boundary-openarchiver_alt';

		/**
		 * Wraps already-built MIME parts (each "headers + blank line + content") in a
		 * multipart entity. Returns a header fragment starting at Content-Type so it can
		 * serve as the top-level body or be nested as a part itself.
		 */
		const wrapMultipart = (
			contentType: string,
			wrapBoundary: string,
			parts: string[]
		): string => {
			let out = `Content-Type: ${contentType}; boundary="${wrapBoundary}"` + CRLF + CRLF;
			for (const part of parts) {
				out += `--${wrapBoundary}` + CRLF + part + CRLF + CRLF;
			}
			out += `--${wrapBoundary}--` + CRLF;
			return out;
		};

		const headerLines: string[] = [];

		if (msg.senderName || msg.senderEmailAddress) {
			// For Exchange-internal senders, senderEmailAddress is an X.500 legacy DN
			// ("/O=EXCHANGELABS/..."); resolve the real SMTP address where possible and
			// keep the DN only as a last resort.
			const senderAddress = this.resolveSenderSmtpAddress(msg) || msg.senderEmailAddress;
			headerLines.push(`From: ${this.formatAddress(msg.senderName, senderAddress)}`);
		}

		const { to, cc, bcc } = this.collectRecipients(msg);
		// The recipient table can be missing in exported PSTs; fall back to the
		// display strings ("; "-separated names) Outlook stores on the message.
		if (to.length === 0 && msg.displayTo) {
			to.push(...this.splitDisplayNames(msg.displayTo));
		}
		if (cc.length === 0 && msg.displayCC) {
			cc.push(...this.splitDisplayNames(msg.displayCC));
		}
		if (bcc.length === 0 && msg.displayBCC) {
			bcc.push(...this.splitDisplayNames(msg.displayBCC));
		}
		if (to.length > 0) {
			headerLines.push(`To: ${to.join(', ')}`);
		}
		if (cc.length > 0) {
			headerLines.push(`Cc: ${cc.join(', ')}`);
		}
		if (bcc.length > 0) {
			headerLines.push(`Bcc: ${bcc.join(', ')}`);
		}
		if (msg.subject) {
			headerLines.push(`Subject: ${this.encodeHeaderText(msg.subject)}`);
		}
		if (msg.clientSubmitTime) {
			headerLines.push(`Date: ${new Date(msg.clientSubmitTime).toUTCString()}`);
		}
		if (msg.internetMessageId) {
			headerLines.push(`Message-ID: <${this.stripAngleBrackets(msg.internetMessageId)}>`);
		}
		if (msg.inReplyToId) {
			headerLines.push(`In-Reply-To: <${this.stripAngleBrackets(msg.inReplyToId)}>`);
		}
		// PidTagConversationId is raw binary — hex-encode it, otherwise arbitrary bytes
		// (including CR/LF) end up inside the header block and corrupt the message.
		// getThreadId() consumes this header as a threading fallback.
		if (msg.conversationId?.length) {
			headerLines.push(`Conversation-Id: ${msg.conversationId.toString('hex')}`);
		}
		headerLines.push('MIME-Version: 1.0');

		// Body: text and/or HTML versions, base64-encoded so that raw Outlook HTML
		// (unlimited line lengths, arbitrary content) cannot break the MIME framing.
		const bodyParts: string[] = [];
		if (msg.body) {
			bodyParts.push(
				'Content-Type: text/plain; charset="utf-8"' +
					CRLF +
					'Content-Transfer-Encoding: base64' +
					CRLF +
					CRLF +
					this.toBase64Lines(Buffer.from(msg.body, 'utf-8'))
			);
		}
		if (msg.bodyHTML) {
			bodyParts.push(
				'Content-Type: text/html; charset="utf-8"' +
					CRLF +
					'Content-Transfer-Encoding: base64' +
					CRLF +
					CRLF +
					this.toBase64Lines(Buffer.from(msg.bodyHTML, 'utf-8'))
			);
		}
		if (bodyParts.length === 0) {
			bodyParts.push('Content-Type: text/plain; charset="utf-8"' + CRLF + CRLF);
		}

		const bodySection =
			bodyParts.length > 1
				? wrapMultipart('multipart/alternative', altBoundary, bodyParts)
				: bodyParts[0];

		const attachmentParts: string[] = [];
		if (msg.hasAttachments) {
			for (let i = 0; i < msg.numberOfAttachments; i++) {
				try {
					const attachment = msg.getAttachment(i);
					const attachmentStream = attachment.fileInputStream;
					if (!attachmentStream) {
						continue;
					}
					const attachmentBuffer = Buffer.alloc(attachment.filesize);
					attachmentStream.readCompletely(attachmentBuffer);
					const filename = this.encodeHeaderText(
						attachment.longFilename || attachment.filename || `attachment-${i + 1}`
					).replace(/"/g, "'");
					const mimeType =
						this.sanitizeHeaderValue(attachment.mimeTag) || 'application/octet-stream';
					const contentId = this.stripAngleBrackets(attachment.contentId);
					let part = `Content-Type: ${mimeType}; name="${filename}"` + CRLF;
					// Parts referenced from the HTML via cid: need a Content-ID and inline
					// disposition, or previews cannot resolve embedded images.
					part +=
						`Content-Disposition: ${contentId ? 'inline' : 'attachment'}; filename="${filename}"` +
						CRLF;
					if (contentId) {
						part += `Content-ID: <${contentId}>` + CRLF;
					}
					part += 'Content-Transfer-Encoding: base64' + CRLF + CRLF;
					part += this.toBase64Lines(attachmentBuffer);
					attachmentParts.push(part);
				} catch (error) {
					// A single corrupt attachment should not lose the whole email.
					logger.warn({ error }, 'Skipping unreadable PST attachment');
				}
			}
		}

		let eml = headerLines.join(CRLF) + CRLF;
		if (attachmentParts.length > 0) {
			eml += wrapMultipart('multipart/mixed', boundary, [bodySection, ...attachmentParts]);
		} else {
			eml += bodySection;
		}
		return eml;
	}

	/**
	 * Resolves the sender's SMTP address for messages whose PR_SENDER_EMAIL_ADDRESS
	 * holds an Exchange X.500 legacy DN (internal senders and Sent Items). Returns ''
	 * when no SMTP form exists in the message.
	 */
	private resolveSenderSmtpAddress(msg: PSTMessage): string {
		const senderEmail = msg.senderEmailAddress || '';
		// Already SMTP ("EX" DNs never contain '@').
		if (senderEmail.includes('@')) {
			return senderEmail;
		}

		// PidTagSenderSmtpAddress / PidTagSentRepresentingSmtpAddress carry the SMTP
		// form for EX senders in modern exports. pst-extractor has no public getter for
		// them, so read the properties through the (TypeScript-only) protected reader.
		const readProperty = (id: number): string => {
			try {
				return (
					(msg as unknown as { getStringItem(identifier: number): string }).getStringItem(
						id
					) || ''
				);
			} catch {
				return '';
			}
		};

		// Received mail often retains the original internet headers — take the From:
		// addr-spec from there. Unfold folded header lines first.
		const fromTransportHeaders = (): string => {
			const transportHeaders = (msg.transportMessageHeaders || '').replace(
				/\r?\n[ \t]+/g,
				' '
			);
			const fromLine = transportHeaders.match(/^From:[^\r\n]*$/im)?.[0] ?? '';
			return (
				fromLine.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ??
				fromLine.match(/^From:\s*([^<>\s]+@[^<>\s]+)\s*$/i)?.[1] ??
				''
			);
		};

		const smtpProperty = readProperty(0x5d01) || readProperty(0x5d02);
		const sentRepresenting = msg.sentRepresentingEmailAddress || '';

		let resolved = '';
		if (smtpProperty.includes('@')) {
			resolved = smtpProperty;
		} else if (sentRepresenting.includes('@')) {
			resolved = sentRepresenting;
		} else {
			resolved = fromTransportHeaders();
		}

		const dnKey = senderEmail.toLowerCase();
		if (resolved) {
			if (dnKey) {
				this.dnToSmtp.set(dnKey, resolved);
			}
			return resolved;
		}
		// Sent Items usually carry neither transport headers nor the SMTP properties;
		// fall back to what this walk has already learned about this DN.
		return this.dnToSmtp.get(dnKey) ?? '';
	}

	/** Strips CR/LF/NUL so a header value cannot terminate or corrupt the header block. */
	private sanitizeHeaderValue(value: string | undefined): string {
		return (value ?? '').replace(/[\r\n\0]+/g, ' ').trim();
	}

	/** RFC 2047 B-encodes a header value when it contains non-ASCII characters. */
	private encodeHeaderText(value: string): string {
		const sanitized = this.sanitizeHeaderValue(value);
		if (!/[^\x20-\x7e]/.test(sanitized)) {
			return sanitized;
		}
		return `=?utf-8?B?${Buffer.from(sanitized, 'utf-8').toString('base64')}?=`;
	}

	/** Sanitizes an identifier for use inside <...> in Message-ID-style headers. */
	private stripAngleBrackets(value: string | undefined): string {
		return this.sanitizeHeaderValue(value).replace(/^<+|>+$/g, '');
	}

	/** Formats a single mailbox for an address header. Either argument may be empty. */
	private formatAddress(name: string | undefined, email: string | undefined): string {
		const safeName = name ? this.encodeHeaderText(name) : '';
		const safeEmail = this.sanitizeHeaderValue(email).replace(/[<>]/g, '');
		if (safeName && safeEmail) {
			return `"${safeName.replace(/"/g, "'")}" <${safeEmail}>`;
		}
		return safeEmail || safeName;
	}

	/** Splits an Outlook display string ("Name A; Name B") into header-safe tokens. */
	private splitDisplayNames(display: string): string[] {
		return display
			.split(';')
			.map((name) => this.encodeHeaderText(name))
			.filter(Boolean);
	}

	/**
	 * Reads the MAPI recipient table and formats each entry for To/Cc/Bcc headers.
	 * Unlike the display strings, table entries carry real SMTP addresses.
	 */
	private collectRecipients(msg: PSTMessage): { to: string[]; cc: string[]; bcc: string[] } {
		const to: string[] = [];
		const cc: string[] = [];
		const bcc: string[] = [];
		let recipientCount = 0;
		try {
			recipientCount = msg.numberOfRecipients;
		} catch {
			return { to, cc, bcc };
		}
		for (let i = 0; i < recipientCount; i++) {
			try {
				const recipient = msg.getRecipient(i);
				if (!recipient) {
					continue;
				}
				// Recipient rows carry both the X.500 DN and the SMTP form — learn the
				// pairing so unresolvable DN senders (Sent Items) can be mapped later.
				const recipientDn = (recipient.emailAddress || '').toLowerCase();
				const recipientSmtp = recipient.smtpAddress || '';
				if (recipientDn.startsWith('/') && recipientSmtp.includes('@')) {
					this.dnToSmtp.set(recipientDn, recipientSmtp);
				}
				const formatted = this.formatAddress(
					recipient.displayName,
					recipient.smtpAddress || recipient.emailAddress
				);
				if (!formatted) {
					continue;
				}
				// PR_RECIPIENT_TYPE: 1 = To, 2 = Cc, 3 = Bcc.
				if (recipient.recipientType === 2) {
					cc.push(formatted);
				} else if (recipient.recipientType === 3) {
					bcc.push(formatted);
				} else {
					to.push(formatted);
				}
			} catch {
				// Individually corrupt recipient rows are skipped; the rest are kept.
			}
		}
		return { to, cc, bcc };
	}

	/** Base64-encodes content wrapped at 76 columns, per RFC 2045 line-length limits. */
	private toBase64Lines(content: Buffer): string {
		return content.toString('base64').replace(/(.{76})(?=.)/g, '$1\r\n');
	}

	public getUpdatedSyncState(): SyncState {
		return {};
	}
}
