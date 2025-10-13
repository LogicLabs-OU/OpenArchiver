import type {
	PSTImportCredentials,
	EmailObject,
	EmailAddress,
	SyncState,
	MailboxUser,
} from '@open-archiver/types';
import type { IEmailConnector } from '../EmailProviderFactory';
import { PSTFile, PSTFolder, PSTMessage } from 'pst-extractor';
import { simpleParser, ParsedMail, Attachment, AddressObject } from 'mailparser';
import { logger } from '../../config/logger';
import { getThreadId } from './helpers/utils';
import { StorageService } from '../StorageService';
import { Readable } from 'stream';
import { createHash } from 'crypto';

const streamToBuffer = (stream: Readable): Promise<Buffer> => {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on('data', (chunk) => chunks.push(chunk));
		stream.on('error', reject);
		stream.on('end', () => resolve(Buffer.concat(chunks)));
	});
};

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
	private pstFile: PSTFile | null = null;

	constructor(private credentials: PSTImportCredentials) {
		this.storage = new StorageService();
	}

	private async loadPstFile(): Promise<PSTFile> {
		if (this.pstFile) {
			return this.pstFile;
		}
		const fileStream = await this.storage.get(this.credentials.uploadedFilePath);
		const buffer = await streamToBuffer(fileStream as Readable);
		this.pstFile = new PSTFile(buffer);
		return this.pstFile;
	}

	public async testConnection(): Promise<boolean> {
		try {
			if (!this.credentials.uploadedFilePath) {
				throw Error('PST file path not provided.');
			}
			if (!this.credentials.uploadedFilePath.includes('.pst')) {
				throw Error('Provided file is not in the PST format.');
			}
			const fileExist = await this.storage.exists(this.credentials.uploadedFilePath);
			if (!fileExist) {
				throw Error('PST file upload not finished yet, please wait.');
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
		try {
			pstFile = await this.loadPstFile();
			const root = pstFile.getRootFolder();
			const displayName: string =
				root.displayName || pstFile.pstFilename || String(new Date().getTime());
			logger.info(`Found potential mailbox: ${displayName}`);
			const constructedPrimaryEmail = `${displayName.replace(/ /g, '.').toLowerCase()}@pst.local`;
			yield {
				id: constructedPrimaryEmail,
				// We will address the primaryEmail problem in the next section.
				primaryEmail: constructedPrimaryEmail,
				displayName: displayName,
			};
		} catch (error) {
			logger.error({ error }, 'Failed to list users from PST file.');
			pstFile?.close();
			throw error;
		} finally {
			pstFile?.close();
		}
	}

	public async *fetchEmails(
		userEmail: string,
		syncState?: SyncState | null
	): AsyncGenerator<EmailObject | null> {
		let pstFile: PSTFile | null = null;
		try {
			pstFile = await this.loadPstFile();
			const root = pstFile.getRootFolder();
			yield* this.processFolder(root, '', userEmail);
		} catch (error) {
			logger.error({ error }, 'Failed to fetch email.');
			pstFile?.close();
			throw error;
		} finally {
			pstFile?.close();
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
					console.warn("Folder doesn't have child");
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
		const parsedEmail: ParsedMail = await simpleParser(emlBuffer);

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
			eml: emlBuffer,
			path,
		};
	}

	private async constructEml(msg: PSTMessage): Promise<string> {
		let eml = '';
		const boundary = '----boundary-openarchiver';
		const altBoundary = '----boundary-openarchiver_alt';

		let headers = '';

		if (msg.senderName || msg.senderEmailAddress) {
			headers += `From: ${msg.senderName} <${msg.senderEmailAddress}>\n`;
		}
		if (msg.displayTo) {
			headers += `To: ${msg.displayTo}\n`;
		}
		if (msg.displayCC) {
			headers += `Cc: ${msg.displayCC}\n`;
		}
		if (msg.displayBCC) {
			headers += `Bcc: ${msg.displayBCC}\n`;
		}
		if (msg.subject) {
			headers += `Subject: ${msg.subject}\n`;
		}
		if (msg.clientSubmitTime) {
			headers += `Date: ${new Date(msg.clientSubmitTime).toUTCString()}\n`;
		}
		if (msg.internetMessageId) {
			headers += `Message-ID: <${msg.internetMessageId}>\n`;
		}
		if (msg.inReplyToId) {
			headers += `In-Reply-To: ${msg.inReplyToId}`;
		}
		if (msg.conversationId) {
			headers += `Conversation-Id: ${msg.conversationId}`;
		}
		headers += 'MIME-Version: 1.0\n';

		//add new headers
		if (!/Content-Type:/i.test(headers)) {
			if (msg.hasAttachments) {
				headers += `Content-Type: multipart/mixed; boundary="${boundary}"\n`;
				headers += `Content-Type: multipart/alternative; boundary="${altBoundary}"\n\n`;
				eml += headers;
				eml += `--${boundary}\n\n`;
			} else {
				eml += headers;
				eml += `Content-Type: multipart/alternative; boundary="${altBoundary}"\n\n`;
			}
		}
		// Body
		const hasBody = !!msg.body;
		const hasHtml = !!msg.bodyHTML;

		if (hasBody) {
			eml += `--${altBoundary}\n`;
			eml += 'Content-Type: text/plain; charset="utf-8"\n\n';
			eml += `${msg.body}\n\n`;
		}

		if (hasHtml) {
			eml += `--${altBoundary}\n`;
			eml += 'Content-Type: text/html; charset="utf-8"\n\n';
			eml += `${msg.bodyHTML}\n\n`;
		}

		if (hasBody || hasHtml) {
			eml += `--${altBoundary}--\n`;
		}

		if (msg.hasAttachments) {
			for (let i = 0; i < msg.numberOfAttachments; i++) {
				const attachment = msg.getAttachment(i);
				const attachmentStream = attachment.fileInputStream;
				if (attachmentStream) {
					const attachmentBuffer = Buffer.alloc(attachment.filesize);
					attachmentStream.readCompletely(attachmentBuffer);
					eml += `\n--${boundary}\n`;
					eml += `Content-Type: ${attachment.mimeTag}; name="${attachment.longFilename}"\n`;
					eml += `Content-Disposition: attachment; filename="${attachment.longFilename}"\n`;
					eml += 'Content-Transfer-Encoding: base64\n\n';
					eml += `${attachmentBuffer.toString('base64')}\n`;
				}
			}
			eml += `\n--${boundary}--`;
		}

		return eml;
	}

	public getUpdatedSyncState(): SyncState {
		return {};
	}
}
