/**
 * Unit test: NUL stripping of parsed email fields, including the non-string values mailparser can
 * hand back. Runs against the compiled backend (`pnpm build` first):
 *
 *   pnpm --filter @open-archiver/backend test:unit
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { stripNullBytes, stripNullBytesOrEmpty } from '../dist/helpers/stripNullBytes.js';

describe('stripNullBytes', () => {
	test('removes NUL characters', () => {
		assert.equal(stripNullBytes('Sub\0ject\0'), 'Subject');
	});
});

describe('stripNullBytesOrEmpty', () => {
	test('strips strings like stripNullBytes', () => {
		assert.equal(stripNullBytesOrEmpty('image/\0png'), 'image/png');
	});

	test('turns non-strings into an empty string', () => {
		for (const value of [false, true, undefined, null, 0, {}, []]) {
			assert.equal(stripNullBytesOrEmpty(value), '');
		}
	});

	test('handles the contentType mailparser returns for an unparsable Content-Type header', async () => {
		const raw = [
			'From: sender@example.com',
			'To: rcpt@example.com',
			'Subject: Attachment with an empty Content-Type',
			'Message-ID: <empty-content-type@example.com>',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="b1"',
			'',
			'--b1',
			'Content-Type: text/plain; charset=us-ascii',
			'',
			'body',
			'--b1',
			'Content-Type: ;',
			' name="terms.txt"',
			'Content-Disposition: attachment; filename="terms.txt"',
			'Content-Transfer-Encoding: base64',
			'',
			Buffer.from('terms').toString('base64'),
			'--b1--',
			'',
		].join('\r\n');

		const parsed = await simpleParser(Buffer.from(raw));
		const attachment = parsed.attachments[0];
		// The precondition this guards against: mailparser does not give a string here.
		assert.equal(typeof attachment.contentType, 'boolean');
		assert.equal(stripNullBytesOrEmpty(attachment.contentType), '');
		assert.equal(stripNullBytesOrEmpty(attachment.filename), 'terms.txt');
	});
});
