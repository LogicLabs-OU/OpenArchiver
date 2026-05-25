import { describe, it, expect } from 'vitest';
import { extractOriginalDate } from './dateExtractor';

const RECENT_ISO = '2024-04-02T10:00:00.000Z';
const RECENT_MS = Date.parse(RECENT_ISO);

/** Convenience: build a headers Map mailparser-style. */
function makeHeaders(entries: Record<string, unknown>): Map<string, unknown> {
	return new Map(Object.entries(entries));
}

describe('extractOriginalDate', () => {
	it('uses parsedEmail.date when it is a valid recent date (source: header)', () => {
		const date = new Date(RECENT_ISO);
		const result = extractOriginalDate({ date });
		expect(result.source).toBe('header');
		expect(result.date?.getTime()).toBe(RECENT_MS);
	});

	it('falls through to Received: chain when parsedEmail.date is missing', () => {
		const headers = makeHeaders({
			received: [
				'from mx1.example.com by mx2.example.com; Tue, 02 Apr 2024 10:00:30 +0000',
				'from sender.example.com by mx1.example.com; Tue, 02 Apr 2024 10:00:00 +0000',
			],
		});
		const result = extractOriginalDate({ headers });
		expect(result.source).toBe('received');
		// last entry wins (chronologically earliest hop)
		expect(result.date?.toISOString()).toBe('2024-04-02T10:00:00.000Z');
	});

	it('falls through to Received: when parsedEmail.date is in the year 0', () => {
		const headers = makeHeaders({
			received: ['from x by y; Tue, 02 Apr 2024 10:00:00 +0000'],
		});
		// year 0000 -> pre-epoch -> rejected
		const date = new Date('0000-01-01T00:00:00.000Z');
		const result = extractOriginalDate({ date, headers });
		expect(result.source).toBe('received');
		expect(result.date?.toISOString()).toBe('2024-04-02T10:00:00.000Z');
	});

	it('falls through to Received: when parsedEmail.date is far in the future', () => {
		const headers = makeHeaders({
			received: ['from x by y; Tue, 02 Apr 2024 10:00:00 +0000'],
		});
		const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // +1 year
		const result = extractOriginalDate({ date: farFuture, headers });
		expect(result.source).toBe('received');
	});

	it('uses headerLines Date: entry when nothing else has a date (source: header)', () => {
		const result = extractOriginalDate({
			headerLines: [
				{ key: 'subject', line: 'Subject: hi' },
				{ key: 'date', line: 'Date: Tue, 02 Apr 2024 10:00:00 +0000' },
			],
		});
		expect(result.source).toBe('header');
		expect(result.date?.toISOString()).toBe('2024-04-02T10:00:00.000Z');
	});

	it('scrapes Date: from the raw EML buffer when no parsed source has it (source: header)', () => {
		const raw = Buffer.from(
			[
				'Subject: hello',
				'From: a@example.com',
				'Date: Tue, 02 Apr 2024 10:00:00 +0000',
				'',
				'Body text here, Date: 1999-01-01 should be ignored.',
			].join('\r\n'),
			'utf-8'
		);
		const result = extractOriginalDate({}, raw);
		expect(result.source).toBe('header');
		expect(result.date?.toISOString()).toBe('2024-04-02T10:00:00.000Z');
	});

	it('returns { date: null, source: unknown } when nothing parses', () => {
		const result = extractOriginalDate({
			headers: makeHeaders({ received: 'not a parseable received line' }),
			headerLines: [{ key: 'subject', line: 'Subject: x' }],
		});
		expect(result.source).toBe('unknown');
		expect(result.date).toBeNull();
	});

	it('accepts Received as a bare string (not an array)', () => {
		const headers = makeHeaders({
			received: 'from x by y; Tue, 02 Apr 2024 10:00:00 +0000',
		});
		const result = extractOriginalDate({ headers });
		expect(result.source).toBe('received');
		expect(result.date?.toISOString()).toBe('2024-04-02T10:00:00.000Z');
	});

	it('iterates the Received chain end-to-start (multi-hop, last entry wins)', () => {
		const headers = makeHeaders({
			received: [
				'from inbound1 by gateway; Wed, 03 Apr 2024 12:00:00 +0000',
				'from relay by inbound1; Tue, 02 Apr 2024 11:00:00 +0000',
				'from sender by relay; Tue, 02 Apr 2024 10:00:00 +0000',
			],
		});
		const result = extractOriginalDate({ headers });
		expect(result.source).toBe('received');
		// last array entry is the earliest hop and should be selected
		expect(result.date?.toISOString()).toBe('2024-04-02T10:00:00.000Z');
	});

	it('handles Received line with a semicolon inside a parenthetical comment', () => {
		// The "for ...; with ESMTP" sub-clause has a semicolon, but the regex
		// must still anchor to the LAST semicolon before the trailing date.
		const headers = makeHeaders({
			received: [
				'from mx.example.com (mx.example.com [10.0.0.1]) by relay.example.com ' +
					'(Postfix; queue 1234) with ESMTPS id ABC; Tue, 02 Apr 2024 10:00:00 +0000',
			],
		});
		const result = extractOriginalDate({ headers });
		expect(result.source).toBe('received');
		expect(result.date?.toISOString()).toBe('2024-04-02T10:00:00.000Z');
	});

	it('does not throw when parsedEmail.date is NaN', () => {
		const headers = makeHeaders({
			received: ['from x by y; Tue, 02 Apr 2024 10:00:00 +0000'],
		});
		const result = extractOriginalDate({ date: new Date(NaN), headers });
		expect(result.source).toBe('received');
	});

	it('returns unknown when rawEml has no Date: header', () => {
		const raw = Buffer.from(
			['Subject: hi', 'From: a@example.com', '', 'body'].join('\r\n'),
			'utf-8'
		);
		const result = extractOriginalDate({}, raw);
		expect(result.source).toBe('unknown');
		expect(result.date).toBeNull();
	});
});
