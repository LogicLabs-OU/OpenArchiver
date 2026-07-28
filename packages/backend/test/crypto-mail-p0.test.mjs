import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simpleParser } from 'mailparser';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'crypto-mail');
const distHelperPath = join(here, '..', 'dist', 'helpers', 'emlUtils.js');

if (!existsSync(join(fixturesDir, 'smime-enveloped.eml'))) {
	execFileSync('bash', [join(fixturesDir, 'gen-fixtures.sh')], { stdio: 'inherit' });
}

if (!existsSync(distHelperPath)) {
	throw new Error('Build backend before running this test: pnpm --filter backend build');
}

const { detectCryptoEnvelope, stripAttachmentsFromEml } = await import(distHelperPath);

function fixture(name) {
	return readFileSync(join(fixturesDir, name));
}

const matrixCases = [
	['smime-enveloped.eml', { isCryptoEnvelope: true, encryption: 'smime', signature: 'none' }],
	[
		'smime-enveloped-pkcs7.eml',
		{ isCryptoEnvelope: true, encryption: 'smime', signature: 'none' },
	],
	[
		'smime-opaque-signed.eml',
		{ isCryptoEnvelope: true, encryption: 'none', signature: 'smime_opaque' },
	],
	[
		'smime-detached-signed.eml',
		{ isCryptoEnvelope: true, encryption: 'none', signature: 'smime_detached' },
	],
	[
		'pgp-mime-encrypted.eml',
		{ isCryptoEnvelope: true, encryption: 'pgp_mime', signature: 'none' },
	],
	['pgp-mime-signed.eml', { isCryptoEnvelope: true, encryption: 'none', signature: 'pgp_mime' }],
	[
		'pgp-inline-encrypted.eml',
		{ isCryptoEnvelope: true, encryption: 'pgp_inline', signature: 'none' },
	],
	[
		'pgp-inline-signed.eml',
		{ isCryptoEnvelope: true, encryption: 'none', signature: 'pgp_inline' },
	],
	[
		'smime-filename-fallback-p7m.eml',
		{ isCryptoEnvelope: true, encryption: 'smime', signature: 'none' },
	],
	[
		'smime-filename-fallback-p7s.eml',
		{ isCryptoEnvelope: true, encryption: 'none', signature: 'smime_detached' },
	],
	['smime-certs-only.eml', { isCryptoEnvelope: true, encryption: 'none', signature: 'none' }],
	[
		'multipart-encrypted-unknown-protocol.eml',
		{ isCryptoEnvelope: true, encryption: 'other', signature: 'none' },
	],
	[
		'multipart-signed-unknown-protocol.eml',
		{ isCryptoEnvelope: true, encryption: 'none', signature: 'other' },
	],
	['quoted-pgp-reply.eml', { isCryptoEnvelope: false, encryption: 'none', signature: 'none' }],
	[
		'pgp-attachment-normal.eml',
		{ isCryptoEnvelope: false, encryption: 'none', signature: 'none' },
	],
	[
		'normal-with-attachment.eml',
		{ isCryptoEnvelope: false, encryption: 'none', signature: 'none' },
	],
];

for (const [name, expected] of matrixCases) {
	assert.deepEqual(detectCryptoEnvelope(fixture(name)), expected, name);
}

for (const name of [
	'smime-enveloped.eml',
	'smime-opaque-signed.eml',
	'smime-detached-signed.eml',
	'pgp-mime-encrypted.eml',
	'pgp-mime-signed.eml',
	'multipart-encrypted-unknown-protocol.eml',
	'multipart-signed-unknown-protocol.eml',
]) {
	const raw = fixture(name);
	const stripped = await stripAttachmentsFromEml(raw);
	assert.equal(Buffer.compare(stripped, raw), 0, `${name} must pass through byte-identical`);
}

const normalRaw = fixture('normal-with-attachment.eml');
const normalStripped = await stripAttachmentsFromEml(normalRaw);
assert.notEqual(Buffer.compare(normalStripped, normalRaw), 0, 'normal email should be rebuilt');

const parsedNormal = await simpleParser(normalStripped);
assert.equal(parsedNormal.text?.includes('Plain body that should survive stripping.'), true);
assert.equal(parsedNormal.attachments.length, 0);

const pgpAttachmentRaw = fixture('pgp-attachment-normal.eml');
const pgpAttachmentStripped = await stripAttachmentsFromEml(pgpAttachmentRaw);
assert.notEqual(
	Buffer.compare(pgpAttachmentStripped, pgpAttachmentRaw),
	0,
	'pgp .asc attachment email should be rebuilt'
);

const parsedPgpAttachment = await simpleParser(pgpAttachmentStripped);
assert.equal(
	parsedPgpAttachment.text?.includes('Plain body; the armor below lives in an attachment only.'),
	true
);
assert.equal(parsedPgpAttachment.attachments.length, 0);

console.log('crypto-mail P0 tests passed');
