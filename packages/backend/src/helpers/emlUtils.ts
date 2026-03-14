import { simpleParser, type Attachment } from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer';
import type Mail from 'nodemailer/lib/mailer';
import { logger } from '../config/logger';

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
