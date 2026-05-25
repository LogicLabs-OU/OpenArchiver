import type { OriginalDateSource } from '@open-archiver/types';
import { logger } from '../config/logger';

export type { OriginalDateSource };

/**
 * The result of running the date-extraction fallback chain.
 * `date` is `null` when no usable date could be determined, and `source` is `'unknown'`.
 */
export interface ExtractedDate {
	date: Date | null;
	source: OriginalDateSource;
}

/**
 * Minimal shape of a parsed email needed to extract its original date.
 * Matches the subset of `mailparser.ParsedMail` we depend on, but kept
 * structural so callers (and tests) can supply lightweight stubs.
 */
export interface ParsedEmailForDateExtraction {
	date?: Date | null;
	headers?: Map<string, unknown> | Record<string, unknown> | undefined;
	headerLines?: ReadonlyArray<{ key: string; line: string }>;
}

/** Clock-skew tolerance for accepting a date that appears to be in the future. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000; // 24h

/** Lower bound — any date older than the Unix epoch is rejected. */
const MIN_TIMESTAMP_MS = Date.UTC(1970, 0, 1);

/**
 * Sanity check: returns the input Date when it is a real, plausibly-correct
 * timestamp; otherwise null. Rejects NaN, pre-epoch dates, and dates more
 * than 24h in the future.
 */
function sanitizeDate(d: Date | null | undefined): Date | null {
	if (!d) return null;
	if (!(d instanceof Date)) return null;
	const t = d.getTime();
	if (!Number.isFinite(t)) return null;
	if (t < MIN_TIMESTAMP_MS) return null;
	if (t > Date.now() + FUTURE_TOLERANCE_MS) return null;
	return d;
}

/** Parses a string with `Date.parse` and runs it through `sanitizeDate`. */
function parseDateString(value: string | undefined | null): Date | null {
	if (!value) return null;
	const t = Date.parse(value);
	if (Number.isNaN(t)) return null;
	return sanitizeDate(new Date(t));
}

/**
 * Reads the `received` entry from a mailparser headers map (which may be a
 * Map or a plain object), and normalizes the value to an array of strings.
 * Returns an empty array when no `received` header is present.
 */
function getReceivedHeaderValues(
	headers: ParsedEmailForDateExtraction['headers']
): string[] {
	if (!headers) return [];

	let raw: unknown;
	if (headers instanceof Map) {
		raw = headers.get('received');
	} else if (typeof headers === 'object') {
		// Headers from mailparser are usually a Map, but support plain objects too
		// for ergonomic test stubbing. Try both lowercase and 'Received'.
		const rec = headers as Record<string, unknown>;
		raw = rec['received'] ?? rec['Received'];
	}

	if (raw == null) return [];
	if (typeof raw === 'string') return [raw];
	if (Array.isArray(raw)) {
		return raw.filter((v): v is string => typeof v === 'string');
	}
	return [];
}

/**
 * Extracts the trailing `; <date>` suffix from a single `Received:` header
 * line. RFC 5322 puts the date at the very end after the last semicolon,
 * even when earlier "for ..." or parenthetical comment segments contain
 * their own semicolons. We anchor to end-of-string to be robust.
 */
function extractReceivedDateString(line: string): string | null {
	// /;\s*([^;]+?)\s*$/ — last semicolon-delimited suffix
	const match = line.match(/;\s*([^;]+?)\s*$/);
	return match ? match[1] : null;
}

/**
 * Extracts the value portion (everything after the first colon) from a raw
 * header line like `Date: Tue, 02 Apr 2024 10:00:00 +0000`.
 */
function extractHeaderLineValue(line: string): string | null {
	const idx = line.indexOf(':');
	if (idx === -1) return null;
	return line.slice(idx + 1).trim();
}

/**
 * Walks `headerLines` looking for a `Date:` line and returns its parseable value.
 */
function extractRawDateFromHeaderLines(
	headerLines: ParsedEmailForDateExtraction['headerLines']
): Date | null {
	if (!headerLines || headerLines.length === 0) return null;
	for (const entry of headerLines) {
		if (!entry || typeof entry.key !== 'string') continue;
		if (entry.key.toLowerCase() !== 'date') continue;
		const value = extractHeaderLineValue(entry.line);
		const parsed = parseDateString(value);
		if (parsed) return parsed;
	}
	return null;
}

/**
 * Last-ditch fallback: scan the first 16 KB of the raw EML buffer for a
 * `Date:` header. We stop at the end of the header block (first blank line)
 * to avoid picking up `Date:` strings buried inside the body.
 */
function extractDateFromRawEml(rawEml: Buffer | undefined): Date | null {
	if (!rawEml || rawEml.length === 0) return null;

	const slice = rawEml.subarray(0, Math.min(rawEml.length, 16 * 1024)).toString('utf-8');

	// Find header block boundary (first blank line). Headers end at \r\n\r\n or \n\n.
	const headerBlockEnd = (() => {
		const crlf = slice.indexOf('\r\n\r\n');
		const lf = slice.indexOf('\n\n');
		const candidates = [crlf, lf].filter((i) => i !== -1);
		return candidates.length > 0 ? Math.min(...candidates) : slice.length;
	})();

	const headerBlock = slice.slice(0, headerBlockEnd);
	const match = headerBlock.match(/^Date:\s*(.+)$/im);
	if (!match) return null;

	return parseDateString(match[1]);
}

/**
 * Determine the original send date of an email using a layered fallback chain:
 *
 *   1. `parsedEmail.date` — the RFC 5322 `Date:` header parsed by mailparser.
 *      Source: `'header'`.
 *   2. The trailing date of the *last* entry in the `Received:` chain (the
 *      earliest originating hop chronologically). Source: `'received'`.
 *   3. A raw `Date:` line from `parsedEmail.headerLines`. Source: `'header'`.
 *   4. A `Date:` line scraped from the raw EML buffer's first 16 KB.
 *      Source: `'header'`.
 *   5. Give up — return `{ date: null, source: 'unknown' }`.
 *
 * Every parsed date is range-checked: must be a real Date, post-epoch, and
 * no more than 24h in the future. Invalid candidates fall through to the
 * next strategy.
 *
 * This function never throws — failures are logged and the chain continues.
 */
export function extractOriginalDate(
	parsedEmail: ParsedEmailForDateExtraction,
	rawEml?: Buffer
): ExtractedDate {
	// Strategy 1: parsedEmail.date
	try {
		const direct = sanitizeDate(parsedEmail.date ?? null);
		if (direct) {
			return { date: direct, source: 'header' };
		}
	} catch (err) {
		logger.debug({ err }, 'extractOriginalDate: parsedEmail.date threw, falling through');
	}

	// Strategy 2: Received: chain (iterate END -> START)
	try {
		const receivedValues = getReceivedHeaderValues(parsedEmail.headers);
		for (let i = receivedValues.length - 1; i >= 0; i--) {
			const dateStr = extractReceivedDateString(receivedValues[i]);
			const parsed = parseDateString(dateStr);
			if (parsed) {
				return { date: parsed, source: 'received' };
			}
		}
	} catch (err) {
		logger.debug({ err }, 'extractOriginalDate: Received chain threw, falling through');
	}

	// Strategy 3: raw Date: line from headerLines
	try {
		const fromHeaderLines = extractRawDateFromHeaderLines(parsedEmail.headerLines);
		if (fromHeaderLines) {
			return { date: fromHeaderLines, source: 'header' };
		}
	} catch (err) {
		logger.debug({ err }, 'extractOriginalDate: headerLines parse threw, falling through');
	}

	// Strategy 4: raw EML scan
	try {
		const fromRaw = extractDateFromRawEml(rawEml);
		if (fromRaw) {
			return { date: fromRaw, source: 'header' };
		}
	} catch (err) {
		logger.debug({ err }, 'extractOriginalDate: raw EML scan threw, falling through');
	}

	// Strategy 5: give up
	logger.warn(
		{ hadRawEml: Boolean(rawEml) },
		'extractOriginalDate: could not determine original date — returning unknown'
	);
	return { date: null, source: 'unknown' };
}
