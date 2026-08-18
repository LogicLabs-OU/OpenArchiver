/**
 * Truncates a string to a UTF-8 byte budget without splitting a character.
 *
 * Cutting on JavaScript string indices is what makes this worth a helper: `String.prototype.slice`
 * counts UTF-16 code units, so a cut landing inside an astral character (emoji, many CJK extensions)
 * leaves an unpaired surrogate. `JSON.stringify` will happily escape that as `\ud83d`, and
 * Meilisearch's JSON parser then rejects the whole request — turning one emoji into a failed write
 * for every document sent with it.
 *
 * Cutting on bytes and backing off over UTF-8 continuation bytes (`10xxxxxx`) lands on a character
 * boundary and keeps the whole budget, rather than reserving four bytes for every character.
 */
export function truncateToBytes(text: string, maxBytes: number): string {
	if (maxBytes <= 0) {
		return '';
	}
	// A character is at most 4 UTF-8 bytes, so below this the budget cannot be exceeded and the
	// measuring pass can be skipped. Worth having: this is the common case for every email body.
	if (text.length <= maxBytes / 4) {
		return text;
	}

	const buf = Buffer.from(text, 'utf8');
	if (buf.byteLength <= maxBytes) {
		return text;
	}

	let end = maxBytes;
	while (end > 0 && (buf[end] & 0xc0) === 0x80) {
		end--;
	}
	return buf.subarray(0, end).toString('utf8');
}
