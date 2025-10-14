import type { Headers } from 'mailparser';

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

export function getDate(value: string | Date | undefined): Date | undefined {
	if (!value) {
		return undefined;
	}

	let date = value instanceof Date ? value : new Date(value);

	if (date.toString() === 'Invalid Date') {
		return undefined;
	}

	return date;
}
