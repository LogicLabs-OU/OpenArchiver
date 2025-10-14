import type { FetchMessageObject } from 'imapflow';
import type { Headers, ParsedMail } from 'mailparser';
import { logger } from '../../../config/logger';

function getHeaderValue(header: any): string | undefined {
	if (typeof header === 'string') {
		return header;
	}
	if (Array.isArray(header)) {
		return getHeaderValue(header[0]);
	}
	if (typeof header === 'object' && header !== null && 'value' in header) {
		return getHeaderValue(header.value);
	}
	return undefined;
}

export function getThreadId(headers: Headers): string | undefined {
	const referencesHeader = headers.get('references');

	if (referencesHeader) {
		const references = getHeaderValue(referencesHeader);
		if (references) {
			return references.split(' ')[0].trim();
		}
	}

	const inReplyToHeader = headers.get('in-reply-to');

	if (inReplyToHeader) {
		const inReplyTo = getHeaderValue(inReplyToHeader);
		if (inReplyTo) {
			return inReplyTo.trim();
		}
	}

	const conversationIdHeader = headers.get('conversation-id');

	if (conversationIdHeader) {
		const conversationId = getHeaderValue(conversationIdHeader);
		if (conversationId) {
			return conversationId.trim();
		}
	}

	const messageIdHeader = headers.get('message-id');

	if (messageIdHeader) {
		const messageId = getHeaderValue(messageIdHeader);
		if (messageId) {
			return messageId.trim();
		}
	}
	console.warn('No thread ID found, returning undefined');
	return undefined;
}

export function getMailDate(mail: ParsedMail, msg: FetchMessageObject): Date {
	// First we try to get the date from the email headers.
	const dateFromHeader = mail.headers.get('date');
	const headerDate = getHeaderValue(dateFromHeader);

	// Some emails might have an invalid date header that cannot be parsed by mailparser.
	// (e.g. "Date: [date", "date: Wed, 10 Apr 2019 18:01:01 Asia/Shanghai")
	// In that case, mail parser will fallback to current date, which is not what we want.
	// See: https://github.com/nodemailer/mailparser/blob/v3.7.5/lib/mail-parser.js#L333
	const isHeaderDateValid = headerDate && !isNaN(new Date(headerDate).getTime());

	// So if the header date is valid, we use it. Otherwise we fallback to internalDate.
	if (isHeaderDateValid && mail.date) {
		return mail.date;
	}

	// INTERNALDATE: the date and time when the message was received by the server.
	// See: https://datatracker.ietf.org/doc/html/rfc3501#section-2.3.3
	const internalDate = msg.internalDate;

	if (internalDate) {
		const date = internalDate instanceof Date ? internalDate : new Date(internalDate);
		if (!isNaN(date.getTime())) {
			return date;
		}
	}

	logger.warn({ mail, msg }, 'Email date is missing or invalid');
	return new Date();
}
