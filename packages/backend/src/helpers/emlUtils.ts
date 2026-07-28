import { simpleParser, type Attachment } from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer';
import type Mail from 'nodemailer/lib/mailer';
import { logger } from '../config/logger';

export type CryptoEnvelopeDetection = {
	isCryptoEnvelope: boolean;
	encryption: 'none' | 'smime' | 'pgp_mime' | 'pgp_inline' | 'other';
	signature: 'none' | 'smime_opaque' | 'smime_detached' | 'pgp_mime' | 'pgp_inline' | 'other';
};

/**
 * Set of headers that are either handled natively by nodemailer's MailComposer
 * via dedicated options, or are structural MIME headers that will be regenerated
 * when the MIME tree is rebuilt.
 */
const HEADERS_HANDLED_BY_COMPOSER = new Set([
	'content-type',
	'content-transfer-encoding',
	'mime-version',
	'from',
	'to',
	'cc',
	'bcc',
	'subject',
	'message-id',
	'date',
	'in-reply-to',
	'references',
	'reply-to',
	'sender',
]);

function emptyDetection(): CryptoEnvelopeDetection {
	return {
		isCryptoEnvelope: false,
		encryption: 'none',
		signature: 'none',
	};
}

function findHeaderEnd(raw: Buffer): { headerEnd: number; bodyStart: number } {
	const crlf = raw.indexOf('\r\n\r\n');
	const lf = raw.indexOf('\n\n');

	if (crlf !== -1 && (lf === -1 || crlf < lf)) {
		return { headerEnd: crlf, bodyStart: crlf + 4 };
	}

	if (lf !== -1) {
		return { headerEnd: lf, bodyStart: lf + 2 };
	}

	return { headerEnd: raw.length, bodyStart: raw.length };
}

function parseHeaderBlock(headerBlock: string): Map<string, string> {
	const headers = new Map<string, string>();
	const lines = headerBlock.replace(/\r\n/g, '\n').split('\n');
	let currentName = '';

	for (const line of lines) {
		if (/^[\t ]/.test(line) && currentName) {
			headers.set(currentName, `${headers.get(currentName) || ''} ${line.trim()}`);
			continue;
		}

		const separator = line.indexOf(':');
		if (separator === -1) {
			currentName = '';
			continue;
		}

		currentName = line.slice(0, separator).toLowerCase();
		headers.set(currentName, line.slice(separator + 1).trim());
	}

	return headers;
}

function splitHeaderValue(value: string): string[] {
	const parts: string[] = [];
	let part = '';
	let quoted = false;

	for (let i = 0; i < value.length; i += 1) {
		const char = value[i];
		if (char === '"' && value[i - 1] !== '\\') {
			quoted = !quoted;
		}
		if (char === ';' && !quoted) {
			parts.push(part.trim());
			part = '';
			continue;
		}
		part += char;
	}
	parts.push(part.trim());
	return parts;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseStructuredHeader(value: string | undefined): {
	value: string;
	params: Map<string, string>;
} {
	if (!value) {
		return { value: '', params: new Map() };
	}

	const [mediaType = '', ...paramParts] = splitHeaderValue(value);
	const params = new Map<string, string>();

	for (const paramPart of paramParts) {
		const separator = paramPart.indexOf('=');
		if (separator === -1) {
			continue;
		}
		params.set(
			paramPart.slice(0, separator).trim().toLowerCase(),
			unquote(paramPart.slice(separator + 1))
		);
	}

	return {
		value: mediaType.toLowerCase(),
		params,
	};
}

function filenamesFromHeaders(headers: Map<string, string>): string[] {
	const names: string[] = [];
	for (const header of ['content-type', 'content-disposition']) {
		const parsed = parseStructuredHeader(headers.get(header));
		for (const key of ['name', 'filename']) {
			const value = parsed.params.get(key);
			if (value) {
				names.push(value.toLowerCase());
			}
		}
	}
	return names;
}

type MimePartProbe = {
	headers: Map<string, string>;
	body: string;
};

function getFirstLevelParts(body: string, boundary: string | undefined): MimePartProbe[] {
	if (!boundary) {
		return [];
	}

	const parts: MimePartProbe[] = [];
	const lines = body.replace(/\r\n/g, '\n').split('\n');
	const boundaryLine = `--${boundary}`;
	const closingBoundaryLine = `--${boundary}--`;
	let partLines: string[] | null = null;

	for (const line of lines) {
		const trimmed = line.trimEnd();
		if (trimmed === boundaryLine || trimmed === closingBoundaryLine) {
			if (partLines) {
				const partText = partLines.join('\n');
				const headerEnd = partText.indexOf('\n\n');
				const headerBlock = headerEnd === -1 ? partText : partText.slice(0, headerEnd);
				const partBody = headerEnd === -1 ? '' : partText.slice(headerEnd + 2);
				parts.push({ headers: parseHeaderBlock(headerBlock), body: partBody });
			}
			partLines = trimmed === closingBoundaryLine ? null : [];
			if (trimmed === closingBoundaryLine) {
				break;
			}
			continue;
		}

		if (partLines) {
			partLines.push(line);
		}
	}

	return parts;
}

const PGP_MESSAGE_BEGIN = /^-----BEGIN PGP MESSAGE-----/m;
const PGP_MESSAGE_END = /^-----END PGP MESSAGE-----/m;
const PGP_SIGNED_BEGIN = /^-----BEGIN PGP SIGNED MESSAGE-----/m;

function bodyContainsPgp(body: string): Pick<CryptoEnvelopeDetection, 'encryption' | 'signature'> {
	// Anchored at line start so quoted armor in replies ("> -----BEGIN ...")
	// does not flag an ordinary email as encrypted.
	const normalized = body.replace(/\r\n/g, '\n');

	if (PGP_MESSAGE_BEGIN.test(normalized) && PGP_MESSAGE_END.test(normalized)) {
		return { encryption: 'pgp_inline', signature: 'none' };
	}

	if (PGP_SIGNED_BEGIN.test(normalized)) {
		return { encryption: 'none', signature: 'pgp_inline' };
	}

	return { encryption: 'none', signature: 'none' };
}

/**
 * Detects top-level S/MIME and PGP envelopes without parsing or reserializing MIME.
 */
export function detectCryptoEnvelope(raw: Buffer): CryptoEnvelopeDetection {
	const { headerEnd, bodyStart } = findHeaderEnd(raw);
	const headers = parseHeaderBlock(raw.subarray(0, headerEnd).toString('latin1'));
	const contentType = parseStructuredHeader(headers.get('content-type'));
	const contentDisposition = parseStructuredHeader(headers.get('content-disposition'));
	const topLevelType = contentType.value;
	const smimeType = contentType.params.get('smime-type')?.toLowerCase();
	const protocol = contentType.params.get('protocol')?.toLowerCase();
	const filenames = [
		...filenamesFromHeaders(headers),
		contentType.params.get('name') || '',
		contentDisposition.params.get('filename') || '',
	];
	const hasFilename = (filename: string) => filenames.some((name) => name === filename);
	const isPkcs7Mime =
		topLevelType === 'application/pkcs7-mime' || topLevelType === 'application/x-pkcs7-mime';
	const isPkcs7Signature =
		topLevelType === 'application/pkcs7-signature' ||
		topLevelType === 'application/x-pkcs7-signature';

	if (isPkcs7Mime) {
		if (smimeType === 'certs-only' || hasFilename('smime.p7c')) {
			return { ...emptyDetection(), isCryptoEnvelope: true };
		}

		if (smimeType === 'signed-data') {
			return {
				isCryptoEnvelope: true,
				encryption: 'none',
				signature: 'smime_opaque',
			};
		}

		return {
			isCryptoEnvelope: true,
			encryption: 'smime',
			signature: 'none',
		};
	}

	if (isPkcs7Signature) {
		return {
			isCryptoEnvelope: true,
			encryption: 'none',
			signature: 'smime_detached',
		};
	}

	const bodyProbe = raw
		.subarray(bodyStart, Math.min(raw.length, bodyStart + 64 * 1024))
		.toString('latin1');

	if (topLevelType.startsWith('multipart/')) {
		const parts = getFirstLevelParts(bodyProbe, contentType.params.get('boundary'));
		const partTypes = parts.map(
			(part) => parseStructuredHeader(part.headers.get('content-type')).value
		);
		const partFilenames = parts.flatMap((part) => filenamesFromHeaders(part.headers));

		if (topLevelType === 'multipart/encrypted') {
			if (
				protocol === 'application/pgp-encrypted' ||
				partTypes.includes('application/pgp-encrypted') ||
				partFilenames.includes('encrypted.asc')
			) {
				return {
					isCryptoEnvelope: true,
					encryption: 'pgp_mime',
					signature: 'none',
				};
			}

			// RFC 1847: multipart/encrypted is always an encrypted envelope, even
			// with an unknown or missing protocol — never let it reach stripping.
			return {
				isCryptoEnvelope: true,
				encryption: 'other',
				signature: 'none',
			};
		}

		if (topLevelType === 'multipart/signed') {
			if (
				protocol === 'application/pgp-signature' ||
				partTypes.includes('application/pgp-signature') ||
				partFilenames.includes('signature.asc')
			) {
				return {
					isCryptoEnvelope: true,
					encryption: 'none',
					signature: 'pgp_mime',
				};
			}

			if (
				protocol === 'application/pkcs7-signature' ||
				protocol === 'application/x-pkcs7-signature' ||
				partTypes.includes('application/pkcs7-signature') ||
				partTypes.includes('application/x-pkcs7-signature') ||
				partFilenames.includes('smime.p7s')
			) {
				return {
					isCryptoEnvelope: true,
					encryption: 'none',
					signature: 'smime_detached',
				};
			}

			// RFC 1847: multipart/signed always carries a signature over the exact
			// bytes of the first part; re-serializing destroys it regardless of the
			// (possibly unknown, missing, or beyond-probe) protocol.
			return {
				isCryptoEnvelope: true,
				encryption: 'none',
				signature: 'other',
			};
		}

		// Only inline PGP in the message text itself makes this a crypto
		// envelope; armor inside attachments (.asc files, quoted forwards)
		// must not stop attachment stripping.
		const firstTextPart = parts.find((part, index) => {
			const partType = partTypes[index];
			return partType === 'text/plain' || partType === '';
		});
		if (firstTextPart) {
			const inlinePgp = bodyContainsPgp(firstTextPart.body);
			if (inlinePgp.encryption !== 'none' || inlinePgp.signature !== 'none') {
				return { isCryptoEnvelope: true, ...inlinePgp };
			}
		}
	}

	if (topLevelType === 'text/plain') {
		const inlinePgp = bodyContainsPgp(bodyProbe);
		if (inlinePgp.encryption !== 'none' || inlinePgp.signature !== 'none') {
			return { isCryptoEnvelope: true, ...inlinePgp };
		}
	}

	return emptyDetection();
}

/**
 * Determines whether a parsed attachment should be preserved in the stored .eml.
 *
 * An attachment is considered inline if:
 * 1. mailparser explicitly marked it as related (embedded in multipart/related)
 * 2. It has Content-Disposition: inline AND a Content-ID
 * 3. Its Content-ID is referenced as a cid: URL in the HTML body
 *
 * All three checks are evaluated with OR logic (conservative: keep if any match).
 */
function isInlineAttachment(attachment: Attachment, referencedCids: Set<string>): boolean {
	// Signal 1: mailparser marks embedded multipart/related resources
	if (attachment.related === true) {
		return true;
	}

	if (attachment.cid) {
		const normalizedCid = attachment.cid.toLowerCase();

		// Signal 2: explicitly marked inline with a CID
		if (attachment.contentDisposition === 'inline') {
			return true;
		}

		// Signal 3: CID is actively referenced in the HTML body
		if (referencedCids.has(normalizedCid)) {
			return true;
		}
	}

	return false;
}

/**
 * Extracts cid: references from an HTML string.
 * Matches patterns like src="cid:abc123" in img tags or CSS backgrounds.
 *
 * @returns A Set of normalized (lowercased) CID values without the "cid:" prefix.
 */
function extractCidReferences(html: string): Set<string> {
	const cidPattern = /\bcid:([^\s"'>]+)/gi;
	const cids = new Set<string>();
	let match: RegExpExecArray | null;
	while ((match = cidPattern.exec(html)) !== null) {
		cids.add(match[1].toLowerCase());
	}
	return cids;
}

/**
 * Extracts additional headers from the parsed email's header map that are NOT
 * handled natively by nodemailer's MailComposer dedicated options.
 * These are passed through as custom headers to preserve the original email metadata.
 */
function extractAdditionalHeaders(
	headers: Map<string, unknown>
): Array<{ key: string; value: string }> {
	const result: Array<{ key: string; value: string }> = [];

	for (const [key, value] of headers) {
		if (HEADERS_HANDLED_BY_COMPOSER.has(key.toLowerCase())) {
			continue;
		}

		if (typeof value === 'string') {
			result.push({ key, value });
		} else if (Array.isArray(value)) {
			// Headers like 'received' can appear multiple times
			for (const item of value) {
				if (typeof item === 'string') {
					result.push({ key, value: item });
				} else if (item && typeof item === 'object' && 'value' in item) {
					result.push({ key, value: String(item.value) });
				}
			}
		} else if (value && typeof value === 'object' && 'value' in value) {
			// Structured headers like { value: '...', params: {...} }
			result.push({ key, value: String((value as { value: string }).value) });
		}
	}

	return result;
}

/**
 * Converts a mailparser AddressObject or AddressObject[] to a comma-separated string
 * suitable for nodemailer's MailComposer options.
 */
function addressToString(
	addresses: import('mailparser').AddressObject | import('mailparser').AddressObject[] | undefined
): string | undefined {
	if (!addresses) return undefined;
	const arr = Array.isArray(addresses) ? addresses : [addresses];
	return arr.map((a) => a.text).join(', ') || undefined;
}

/**
 * Strips non-inline attachments from a raw .eml buffer to avoid double-storing
 * attachment data (since attachments are already stored separately).
 *
 * Inline images referenced via cid: in the HTML body are preserved so that
 * the email renders correctly when viewed.
 *
 * If the email has no strippable attachments, the original buffer is returned
 * unchanged (zero overhead).
 *
 * If re-serialization fails for any reason, the original buffer is returned
 * and a warning is logged — email ingestion is never blocked by this function.
 *
 * @param emlBuffer The raw .eml file as a Buffer.
 * @returns A new Buffer with non-inline attachments removed, or the original if nothing was stripped.
 */
export async function stripAttachmentsFromEml(emlBuffer: Buffer): Promise<Buffer> {
	try {
		if (detectCryptoEnvelope(emlBuffer).isCryptoEnvelope) {
			return emlBuffer;
		}

		const parsed = await simpleParser(emlBuffer);

		// If there are no attachments at all, return early
		if (!parsed.attachments || parsed.attachments.length === 0) {
			return emlBuffer;
		}

		// Build the set of cid values referenced in the HTML body
		const htmlBody = parsed.html || '';
		const referencedCids = extractCidReferences(htmlBody);

		// Check if there's anything to strip
		const hasStrippableAttachments = parsed.attachments.some(
			(a) => !isInlineAttachment(a, referencedCids)
		);

		if (!hasStrippableAttachments) {
			return emlBuffer;
		}

		// Build the list of inline attachments to preserve in the .eml
		const inlineAttachments: Mail.Attachment[] = [];
		for (const attachment of parsed.attachments) {
			if (isInlineAttachment(attachment, referencedCids)) {
				inlineAttachments.push({
					content: attachment.content,
					contentType: attachment.contentType,
					contentDisposition: 'inline' as const,
					filename: attachment.filename || undefined,
					cid: attachment.cid || undefined,
				});
			}
		}

		// Collect additional headers not handled by MailComposer's dedicated fields
		const additionalHeaders = extractAdditionalHeaders(parsed.headers);

		// Build the mail options for MailComposer
		const mailOptions: Mail.Options = {
			from: addressToString(parsed.from),
			to: addressToString(parsed.to),
			cc: addressToString(parsed.cc),
			bcc: addressToString(parsed.bcc),
			replyTo: addressToString(parsed.replyTo),
			subject: parsed.subject,
			messageId: parsed.messageId,
			date: parsed.date,
			inReplyTo: parsed.inReplyTo,
			references: Array.isArray(parsed.references)
				? parsed.references.join(' ')
				: parsed.references,
			text: parsed.text || undefined,
			html: parsed.html || undefined,
			attachments: inlineAttachments,
			headers: additionalHeaders,
		};

		const composer = new MailComposer(mailOptions);
		const builtMessage = composer.compile();
		const stream = builtMessage.createReadStream();

		return await new Promise<Buffer>((resolve, reject) => {
			const chunks: Buffer[] = [];
			stream.on('data', (chunk: Buffer) => chunks.push(chunk));
			stream.on('end', () => resolve(Buffer.concat(chunks)));
			stream.on('error', reject);
		});
	} catch (error) {
		// If stripping fails, return the original buffer unchanged.
		// Email ingestion should never be blocked by an attachment-stripping failure.
		logger.warn(
			{ error },
			'Failed to strip non-inline attachments from .eml — storing original.'
		);
		return emlBuffer;
	}
}
