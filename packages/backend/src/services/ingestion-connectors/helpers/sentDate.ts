import type { ParsedMail } from 'mailparser';
import { logger } from '../../../config/logger';

/** How far past the current time a date may lie before it is treated as a broken clock. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/**
 * Offsets for the zone abbreviations mail software writes in place of a numeric offset. JavaScript
 * reads only the North American ones and UT/GMT, so `14:30:00 CEST` fails to parse without this.
 */
const ZONE_OFFSETS: Record<string, string> = {
	UT: '+0000',
	UTC: '+0000',
	GMT: '+0000',
	Z: '+0000',
	EST: '-0500',
	EDT: '-0400',
	CST: '-0600',
	CDT: '-0500',
	MST: '-0700',
	MDT: '-0600',
	PST: '-0800',
	PDT: '-0700',
	WET: '+0000',
	WEST: '+0100',
	BST: '+0100',
	CET: '+0100',
	CEST: '+0200',
	MEZ: '+0100',
	MESZ: '+0200',
	EET: '+0200',
	EEST: '+0300',
	MSK: '+0300',
	IST: '+0530',
	JST: '+0900',
	AEST: '+1000',
	AEDT: '+1100',
};

/**
 * A date JavaScript can be trusted to read: one naming an English month, or starting with an ISO
 * date. Anything else is left alone, because `new Date('10.05.2026')` does not fail — it returns
 * 5 October, a wrong date that would pass every later check.
 */
const ENGLISH_MONTH =
	/(?<!\p{L})(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)(?!\p{L})/iu;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const usable = (date: Date): Date | null => {
	const time = date.getTime();
	if (Number.isNaN(time) || time < 0 || time > Date.now() + MAX_FUTURE_MS) {
		return null;
	}
	return date;
};

const parseStrict = (value: string): Date | null => {
	if (!ENGLISH_MONTH.test(value) && !ISO_DATE.test(value)) {
		return null;
	}
	return usable(new Date(value));
};

/**
 * Parses an RFC 5322 date as written in practice: tried as is first, then with comments, a leading
 * weekday (in any language) and a trailing zone name tidied away.
 */
const parseMailDate = (value: string): Date | null => {
	const direct = parseStrict(value);
	if (direct) {
		return direct;
	}
	const tidied = value
		.replace(/\([^)]*\)/g, ' ')
		.replace(/^\s*[A-Za-z]{2,3}\.?,?\s+/, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\s([A-Za-z]{1,5})$/, (match, zone: string) => {
			const offset = ZONE_OFFSETS[zone.toUpperCase()];
			return offset ? ` ${offset}` : match;
		});
	return parseStrict(tidied);
};

/** The unfolded value of each raw header line with this key, top to bottom. */
const rawHeaderValues = (parsedEmail: ParsedMail, key: string): string[] =>
	(parsedEmail.headerLines ?? [])
		.filter((header) => header.key === key)
		.map((header) =>
			header.line
				.replace(/^[^:]*:/, '')
				.replace(/\r?\n[ \t]+/g, ' ')
				.trim()
		);

/**
 * Works out when an email was sent, falling back to when it was received.
 *
 * `parsedEmail.date` cannot be used for this. When mailparser fails to read a `Date:` header it
 * does not leave the field empty, it fills in the current time, so an email whose header used a
 * zone name like `CEST` or a German month name was archived as sent at the moment it was fetched
 * (#372). The raw header is parsed here instead, then each `Received:` line from the top (the
 * delivery into the mailbox comes first), then the date the provider recorded, if the connector has
 * one. Only when all of those fail is the current time used, and that is logged.
 *
 * @param providerDate The provider's own record of the message, e.g. IMAP INTERNALDATE.
 */
export function sentDateOf(
	parsedEmail: ParsedMail,
	providerDate?: Date | string | number | null
): Date {
	const [dateHeader] = rawHeaderValues(parsedEmail, 'date');
	if (dateHeader) {
		const fromHeader = parseMailDate(dateHeader);
		if (fromHeader) {
			return fromHeader;
		}
	}

	for (const received of rawHeaderValues(parsedEmail, 'received')) {
		const separator = received.lastIndexOf(';');
		if (separator === -1) {
			continue;
		}
		const fromReceived = parseMailDate(received.slice(separator + 1).trim());
		if (fromReceived) {
			return fromReceived;
		}
	}

	if (providerDate !== undefined && providerDate !== null && providerDate !== '') {
		const fromProvider = usable(new Date(providerDate));
		if (fromProvider) {
			return fromProvider;
		}
	}

	logger.warn(
		{ messageId: parsedEmail.messageId, dateHeader },
		'Email has no usable date, storing the fetch time'
	);
	return new Date();
}
