/**
 * Removes NUL (0x00) characters from a string.
 *
 * Postgres refuses a NUL anywhere in a `text` value — "invalid byte sequence for encoding UTF8:
 * 0x00" — and some old automated emails carry one at the end of the Subject or a display name
 * (#479). One such message failed its insert, and the failure note then carried the same byte
 * into the sync session's error list, so the mailbox could not even report the failure.
 *
 * Only NUL is removed. Other control characters are legal in UTF-8 text, so the database keeps
 * what the message said; the stored .eml is never touched either way.
 */
export const stripNullBytes = (value: string): string => value.replace(/\0/g, '');

/**
 * Makes a string safe to store in any Postgres column, `jsonb` included: removes NUL and replaces
 * each unpaired UTF-16 surrogate with U+FFFD.
 *
 * A lone surrogate is harmless in a `text` column, since the driver's UTF-8 encoding already
 * turns it into U+FFFD. In a `jsonb` column it is fatal: `JSON.stringify` writes it as an escape
 * such as `\ud83d`, and Postgres rejects that ("Unicode low surrogate must follow a high
 * surrogate"). A display name or tag carrying one (a truncated emoji, a mis-decoded UTF-16
 * header) fails the insert on every retry. Replacing it here gives the same U+FFFD a `text`
 * column would have stored.
 */
export const toStorableText = (value: string): string => stripNullBytes(value).toWellFormed();
