/**
 * RFC Message-ID helpers.
 *
 * Gmail METADATA, mailparser, and historically stored rows disagree on whitespace
 * and angle brackets. Compare and cache the canonical form (no wrapping `<>`).
 */

export function canonicalizeMessageId(id: string): string {
	const trimmed = id.trim();
	if (trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.length >= 2) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

/** All on-disk / API spellings we should accept for a single Message-ID. */
export function messageIdVariants(id: string): string[] {
	const canon = canonicalizeMessageId(id);
	if (!canon) {
		return [];
	}
	return [...new Set([id.trim(), canon, `<${canon}>`])];
}

/** Stable form written to archived_emails.message_id_header for new rows. */
export function normalizeMessageIdHeader(id: string): string {
	const canon = canonicalizeMessageId(id);
	if (!canon) {
		return id;
	}
	if (canon.startsWith('generated-')) {
		return canon;
	}
	return `<${canon}>`;
}
