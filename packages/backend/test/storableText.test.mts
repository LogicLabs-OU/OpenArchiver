/**
 * Unit test: email text fields are made safe for every Postgres column type before insert.
 *
 * Runs against the compiled backend (`pnpm build` first):
 *
 *   pnpm --filter @open-archiver/backend test:storable-text
 *
 * The script passes --test-force-exit: importing IngestionService opens its queue connections,
 * which would otherwise keep the process alive after the tests finish.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';

// Importing IngestionService loads the app config, the database client and CryptoService, which
// refuse to load without a storage backend, a database URL and an encryption key. Nothing here
// touches any of them (the database client connects lazily); these only satisfy those checks.
process.env.STORAGE_TYPE ??= 'local';
process.env.STORAGE_LOCAL_ROOT_PATH ??= tmpdir();
process.env.LOG_LEVEL ??= 'silent';
process.env.DATABASE_URL ??= 'postgres://unused@127.0.0.1:1/unused';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

const { toStorableText } = await import('../dist/helpers/stripNullBytes.js');
const { IngestionService } = await import('../dist/services/IngestionService.js');

const HIGH = '\ud83d'; // first half of 😀, alone
const LOW = '\ude00'; // second half of 😀, alone

/**
 * True when JSON text carries a surrogate escape Postgres' jsonb parser rejects: a high one not
 * followed by a low one, or a low one not preceded by a high one.
 */
const hasLoneSurrogateEscape = (json: string): boolean =>
	/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f][0-9a-f]{2})/i.test(json) ||
	/(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i.test(json);

describe('toStorableText', () => {
	test('removes NUL', () => {
		assert.equal(toStorableText('Report\0'), 'Report');
	});

	test('replaces unpaired surrogates with U+FFFD', () => {
		assert.equal(toStorableText(`Anna ${HIGH}`), 'Anna �');
		assert.equal(toStorableText(`${LOW}x`), '�x');
	});

	test('keeps valid pairs and ordinary text intact', () => {
		assert.equal(toStorableText('Anna 😀 Ősz ✓'), 'Anna 😀 Ősz ✓');
	});

	test('the jsonb form of the result has no escape Postgres would reject', () => {
		// The precondition the fix is about: without it, this is what reaches jsonb.
		assert.ok(hasLoneSurrogateEscape(JSON.stringify([{ name: `Anna ${HIGH}` }])));
		assert.ok(
			!hasLoneSurrogateEscape(JSON.stringify([{ name: toStorableText(`Anna ${HIGH}`) }]))
		);
	});
});

describe('IngestionService email sanitising', () => {
	test('cleans the fields that are stored as jsonb (recipients, tags)', () => {
		const email: any = {
			id: `<id${HIGH}@example.com>`,
			subject: `Hi ${HIGH}\0`,
			from: [{ name: `Anna ${HIGH}`, address: 'anna@example.com' }],
			to: [{ name: `Bob ${LOW}`, address: 'bob@example.com\0' }],
			cc: [],
			bcc: [],
			tags: [`label${HIGH}`],
			attachments: [{ filename: `a${HIGH}.pdf`, contentType: 'application/pdf' }],
		};
		(IngestionService as any).stripNullBytesFromEmail(email);

		const recipients = JSON.stringify({ from: email.from, to: email.to });
		assert.ok(!hasLoneSurrogateEscape(recipients), recipients);
		assert.ok(!hasLoneSurrogateEscape(JSON.stringify(email.tags)));
		assert.equal(email.to[0].address, 'bob@example.com');
		assert.equal(email.subject, 'Hi �');
		assert.equal(email.attachments[0].filename, 'a�.pdf');
	});
});
