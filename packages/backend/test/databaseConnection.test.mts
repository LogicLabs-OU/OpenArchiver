/**
 * Unit test: resolving DATABASE_URL and the TLS client-certificate (mTLS) settings.
 *
 * Runs against the compiled backend (`pnpm build` first):
 *
 *   pnpm --filter @open-archiver/backend test:unit:database-connection
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeDatabaseUrl, resolveDatabaseConnection } from '../dist/helpers/db.js';

const URL = 'postgresql://admin:p%40ss@db.example.com:5432/open_archive';

describe('resolveDatabaseConnection', () => {
	let dir = '';
	let cert = '';
	let key = '';
	let ca = '';

	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'oa-db-tls-'));
		cert = join(dir, 'client.crt');
		key = join(dir, 'client.key');
		ca = join(dir, 'ca.crt');
		writeFileSync(cert, 'CERT');
		writeFileSync(key, 'KEY');
		writeFileSync(ca, 'CA');
	});

	after(() => rmSync(dir, { recursive: true, force: true }));

	test('changes nothing when no TLS files are configured', () => {
		const withMode = `${URL}?sslmode=require`;
		assert.deepEqual(resolveDatabaseConnection(URL, {}), {
			connectionString: encodeDatabaseUrl(URL),
		});
		assert.deepEqual(resolveDatabaseConnection(withMode, { PGSSLMODE: 'verify-ca' }), {
			connectionString: encodeDatabaseUrl(withMode),
		});
	});

	test('reads the files named by the PGSSL* environment variables', () => {
		const { connectionString, ssl } = resolveDatabaseConnection(URL, {
			PGSSLCERT: cert,
			PGSSLKEY: key,
			PGSSLROOTCERT: ca,
		});
		assert.equal(connectionString, encodeDatabaseUrl(URL));
		assert.equal(String(ssl?.cert), 'CERT');
		assert.equal(String(ssl?.key), 'KEY');
		assert.equal(String(ssl?.ca), 'CA');
		// Default is verify-full: chain and host name are both checked.
		assert.equal(ssl?.rejectUnauthorized, undefined);
		assert.equal(ssl?.checkServerIdentity, undefined);
	});

	test('takes the files from the URL, removes them from it, and prefers them over the environment', () => {
		const url = `${URL}?sslmode=verify-full&sslcert=${cert}&sslkey=${key}&sslrootcert=${ca}`;
		const { connectionString, ssl } = resolveDatabaseConnection(url, {
			PGSSLCERT: '/does/not/exist',
		});
		// postgres.js would forward the leftovers to the server as session settings.
		assert.equal(connectionString, `${encodeDatabaseUrl(URL)}?sslmode=verify-full`);
		assert.equal(String(ssl?.cert), 'CERT');
	});

	test('leaves sslrootcert=system to postgres.js', () => {
		const url = `${URL}?sslrootcert=system`;
		assert.deepEqual(resolveDatabaseConnection(url, { PGSSLROOTCERT: ca }), {
			connectionString: encodeDatabaseUrl(url),
		});
	});

	test('maps sslmode to certificate verification like libpq', () => {
		const files = { PGSSLCERT: cert, PGSSLKEY: key };
		const verifyCa = resolveDatabaseConnection(`${URL}?sslmode=verify-ca`, files).ssl;
		assert.equal(typeof verifyCa?.checkServerIdentity, 'function');
		assert.equal(verifyCa?.rejectUnauthorized, undefined);

		// `require` verifies the chain once a root certificate is given ...
		const requireWithCa = resolveDatabaseConnection(URL, {
			...files,
			PGSSLROOTCERT: ca,
			PGSSLMODE: 'require',
		}).ssl;
		assert.equal(typeof requireWithCa?.checkServerIdentity, 'function');
		assert.equal(requireWithCa?.rejectUnauthorized, undefined);

		// ... and does not verify at all without one.
		const requireNoCa = resolveDatabaseConnection(`${URL}?sslmode=require`, files).ssl;
		assert.equal(requireNoCa?.rejectUnauthorized, false);

		assert.equal(resolveDatabaseConnection(`${URL}?sslmode=disable`, files).ssl, undefined);
		assert.throws(() => resolveDatabaseConnection(`${URL}?sslmode=bogus`, files), /sslmode/);
	});

	test('rejects a certificate without its key, and unreadable files', () => {
		assert.throws(() => resolveDatabaseConnection(URL, { PGSSLCERT: cert }), /PGSSLKEY/);
		assert.throws(
			() => resolveDatabaseConnection(URL, { PGSSLCERT: cert, PGSSLKEY: join(dir, 'nope') }),
			/Cannot read the PostgreSQL TLS file .*nope.*PGSSLKEY/
		);
	});
});
