import type { EmailObject } from '@open-archiver/types';

// NUL (U+0000) built without a literal control char in source.
const NUL = String.fromCharCode(0);

/**
 * Remove NUL bytes (U+0000) from a string.
 *
 * Postgres text and jsonb values cannot contain U+0000 — an insert carrying one
 * fails with error 22021 (character_not_in_repertoire, routine
 * report_invalid_encoding), which drops the whole email. Some messages (e.g.
 * certain JavaMail notifications) leave NUL padding in decoded header fields,
 * so strip it before persisting. The fast path avoids allocating when clean.
 */
export const stripNullBytes = (value: string): string =>
	value.includes(NUL) ? value.split(NUL).join('') : value;

/**
 * Strip NUL bytes from every parsed-header field of an EmailObject that is
 * persisted to Postgres: subject, sender/recipient names + addresses, the
 * thread/message identifiers, the mailbox path, and attachment filenames /
 * content types. Mutates in place and is idempotent (the journaling fan-out
 * may call processEmail with the same object more than once). Body/HTML are
 * intentionally left alone — they are stored in the raw .eml on disk, not in
 * text columns.
 */
export const sanitizeEmailForStorage = (email: EmailObject): void => {
	email.id = stripNullBytes(email.id);
	email.subject = stripNullBytes(email.subject);
	if (email.threadId) {
		email.threadId = stripNullBytes(email.threadId);
	}
	if (email.path) {
		email.path = stripNullBytes(email.path);
	}
	for (const group of [email.from, email.to, email.cc, email.bcc]) {
		if (!group) continue;
		for (const addr of group) {
			if (addr.name) addr.name = stripNullBytes(addr.name);
			if (addr.address) addr.address = stripNullBytes(addr.address);
		}
	}
	for (const attachment of email.attachments) {
		if (attachment.filename) attachment.filename = stripNullBytes(attachment.filename);
		if (attachment.contentType)
			attachment.contentType = stripNullBytes(attachment.contentType);
	}
};
