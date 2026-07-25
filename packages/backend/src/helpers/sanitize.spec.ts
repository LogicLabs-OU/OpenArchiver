import { describe, it, expect } from 'vitest';
import type { EmailObject } from '@open-archiver/types';
import { stripNullBytes, sanitizeEmailForStorage } from './sanitize';

const NUL = String.fromCharCode(0);

describe('stripNullBytes', () => {
	it('removes NUL bytes from a string', () => {
		expect(stripNullBytes(`UPS Delivery${NUL}${NUL}${NUL}`)).toBe('UPS Delivery');
		expect(stripNullBytes(`a${NUL}b${NUL}c`)).toBe('abc');
	});

	it('returns the same string unchanged when there are no NUL bytes', () => {
		const clean = 'Perfectly normal subject';
		expect(stripNullBytes(clean)).toBe(clean);
		expect(stripNullBytes('')).toBe('');
	});
});

describe('sanitizeEmailForStorage', () => {
	const build = (): EmailObject =>
		({
			id: `<id${NUL}@x.com>`,
			threadId: `t${NUL}1`,
			from: [{ name: `Sender${NUL}`, address: `s${NUL}@x.com` }],
			to: [{ name: 'To', address: 'to@x.com' }],
			cc: [{ name: `CC${NUL}`, address: `cc@x.com` }],
			bcc: undefined,
			subject: `Delivery Confirmation${NUL}${NUL}`,
			body: `body${NUL}kept`,
			html: '',
			headers: new Map(),
			attachments: [{ filename: `file${NUL}.pdf`, contentType: `application/pdf${NUL}`, size: 1, content: Buffer.alloc(0) }],
			receivedAt: new Date(0),
			path: `[Gmail]/Important${NUL}`,
		}) as unknown as EmailObject;

	it('strips NUL bytes from every persisted header field, in place', () => {
		const email = build();
		sanitizeEmailForStorage(email);

		expect(email.id).toBe('<id@x.com>');
		expect(email.threadId).toBe('t1');
		expect(email.subject).toBe('Delivery Confirmation');
		expect(email.path).toBe('[Gmail]/Important');
		expect(email.from[0]).toEqual({ name: 'Sender', address: 's@x.com' });
		expect(email.cc?.[0]).toEqual({ name: 'CC', address: 'cc@x.com' });
		expect(email.attachments[0].filename).toBe('file.pdf');
		expect(email.attachments[0].contentType).toBe('application/pdf');
	});

	it('leaves body/html untouched (not persisted to text columns)', () => {
		const email = build();
		sanitizeEmailForStorage(email);
		// body still contains its NUL — sanitizer intentionally does not touch it.
		expect(email.body).toContain(NUL);
	});

	it('is idempotent', () => {
		const email = build();
		sanitizeEmailForStorage(email);
		const once = { subject: email.subject, id: email.id };
		sanitizeEmailForStorage(email);
		expect({ subject: email.subject, id: email.id }).toEqual(once);
	});
});
