import { DrizzleQueryError } from 'drizzle-orm/errors';
import { stripNullBytes } from './stripNullBytes';

/** Long enough for any database or provider sentence; a status message is not a log. */
const MAX_LENGTH = 500;

/**
 * The one-line text of an error, for sync-session notes and source status messages.
 *
 * Drizzle's `DrizzleQueryError` puts the whole statement and every bound parameter in its
 * `message` and keeps the database's own sentence in `cause`. Reported as-is, a failed insert
 * repeated the email's subject and addresses into the session row — which is how a NUL in a
 * subject failed the insert and then the report of that failure (#479) — and showed them in the
 * UI status text. The cause is the part an operator needs.
 *
 * The result never carries a NUL and never exceeds MAX_LENGTH, whatever the error said.
 */
export const describeError = (error: unknown): string => {
	let text: string;
	if (error instanceof Error) {
		// instanceof, not a name check: the class never sets `name`, so an instance reports
		// "Error" and a name comparison would never match.
		text =
			error instanceof DrizzleQueryError &&
			error.cause instanceof Error &&
			error.cause.message
				? error.cause.message
				: error.message;
	} else {
		text = 'unknown error';
	}
	const cleaned = stripNullBytes(text).replace(/\s+/g, ' ').trim();
	return cleaned.length > MAX_LENGTH ? `${cleaned.slice(0, MAX_LENGTH - 1)}…` : cleaned;
};
