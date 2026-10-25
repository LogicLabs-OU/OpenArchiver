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
 * Like stripNullBytes, for fields that are typed as strings but can reach us as another value.
 * mailparser returns `contentType: false` for an attachment whose Content-Type header has no
 * media type (#509), and `?? ''` lets `false` through. Any non-string becomes an empty string.
 */
export const stripNullBytesOrEmpty = (value: unknown): string =>
	typeof value === 'string' ? stripNullBytes(value) : '';
