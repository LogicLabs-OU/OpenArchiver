import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

// URL already percent-encodes the password; decode it first so it is not encoded twice.
// A '%' that does not start a valid escape is kept as typed.
const decodePassword = (password: string): string => {
	try {
		return decodeURIComponent(password);
	} catch {
		return password;
	}
};

export const encodeDatabaseUrl = (databaseUrl: string): string => {
	try {
		const url = new URL(databaseUrl);
		if (url.password) {
			url.password = encodeURIComponent(decodePassword(url.password));
		}
		return url.toString();
	} catch (error) {
		console.error('Invalid DATABASE_URL, please check your .env file.', error);
		throw new Error('Invalid DATABASE_URL');
	}
};

export interface DatabaseConnection {
	connectionString: string;
	/** Set only when a client certificate or CA file is configured. */
	ssl?: ConnectionOptions;
}

// The libpq names, so the same settings work for psql, pg_dump and Open Archiver alike.
const TLS_FILES = [
	{ option: 'cert', param: 'sslcert', envName: 'PGSSLCERT' },
	{ option: 'key', param: 'sslkey', envName: 'PGSSLKEY' },
	{ option: 'ca', param: 'sslrootcert', envName: 'PGSSLROOTCERT' },
] as const;

const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'];

const readTlsFile = (path: string, source: string): Buffer => {
	try {
		return readFileSync(path);
	} catch (error) {
		throw new Error(
			`Cannot read the PostgreSQL TLS file "${path}" (${source}): ${(error as Error).message}`
		);
	}
};

/**
 * Turns DATABASE_URL into the arguments for postgres.js, adding support for TLS client
 * certificates (mTLS), i.e. PostgreSQL servers that use `cert` authentication or `clientcert`
 * in pg_hba.conf.
 *
 * postgres.js reads neither the `sslcert` / `sslkey` / `sslrootcert` URL parameters nor the
 * PGSSLCERT / PGSSLKEY / PGSSLROOTCERT environment variables. Worse, it forwards URL parameters
 * it does not know to the server as session settings, so a DATABASE_URL carrying `sslcert=...`
 * fails with "unrecognized configuration parameter". The files are therefore resolved here
 * (URL parameter first, then environment variable), removed from the URL, and handed to
 * postgres.js as a TLS options object.
 *
 * With none of them configured the URL is returned as is and nothing changes.
 */
export const resolveDatabaseConnection = (
	databaseUrl: string,
	env: NodeJS.ProcessEnv = process.env
): DatabaseConnection => {
	const url = new URL(encodeDatabaseUrl(databaseUrl));
	const ssl: ConnectionOptions = {};

	for (const { option, param, envName } of TLS_FILES) {
		const fromUrl = url.searchParams.get(param);
		const fromEnv = env[envName];
		// `sslrootcert=system` is postgres.js's own switch for the system CA store, not a file.
		if (param === 'sslrootcert' && fromUrl === 'system') {
			continue;
		}
		if (fromUrl) {
			ssl[option] = readTlsFile(fromUrl, `${param} in DATABASE_URL`);
			url.searchParams.delete(param);
		} else if (fromEnv) {
			ssl[option] = readTlsFile(fromEnv, envName);
		}
	}

	const connectionString = url.toString();
	if (!ssl.cert && !ssl.key && !ssl.ca) {
		return { connectionString };
	}
	if (!ssl.cert !== !ssl.key) {
		throw new Error(
			'PostgreSQL client certificate authentication needs both a certificate (PGSSLCERT) and its private key (PGSSLKEY).'
		);
	}

	// Verification follows libpq's sslmode, except that the default is the strict `verify-full`
	// rather than libpq's `prefer`: someone who configures certificates expects them to be checked.
	const mode =
		url.searchParams.get('sslmode') ??
		url.searchParams.get('ssl') ??
		env.PGSSLMODE ??
		'verify-full';
	if (!SSL_MODES.includes(mode)) {
		throw new Error(
			`Unsupported PostgreSQL sslmode "${mode}". Use one of: ${SSL_MODES.join(', ')}.`
		);
	}
	if (mode === 'disable') {
		return { connectionString };
	}
	if (mode !== 'verify-full') {
		if (mode === 'verify-ca' || ssl.ca) {
			// Check the certificate chain but not the host name. libpq treats `require` the same
			// way once a root certificate is present.
			ssl.checkServerIdentity = () => undefined;
		} else {
			ssl.rejectUnauthorized = false;
		}
	}

	return { connectionString, ssl };
};
