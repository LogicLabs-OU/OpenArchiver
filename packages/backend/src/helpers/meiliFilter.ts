import type { SearchFilters } from '@open-archiver/types';

/**
 * Injection-safe builders for Meilisearch filter expressions used by the advanced
 * search. Values are always escaped and double-quoted; each multi-value clause is
 * self-parenthesized so the joined expression composes safely with AND.
 */

/** Escapes backslashes and double quotes, then wraps the value in double quotes. */
export function quoteMeiliString(value: string): string {
	return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

/** `field = "x"` for one value, `field IN ["x", "y"]` for several. */
export function inClause(field: string, values: string[]): string {
	if (values.length === 1) {
		return `${field} = ${quoteMeiliString(values[0])}`;
	}
	return `${field} IN [${values.map(quoteMeiliString).join(', ')}]`;
}

/** `field != "x"` for one value, `field NOT IN ["x", "y"]` for several. */
export function notInClause(field: string, values: string[]): string {
	if (values.length === 1) {
		return `${field} != ${quoteMeiliString(values[0])}`;
	}
	return `${field} NOT IN [${values.map(quoteMeiliString).join(', ')}]`;
}

/** Parses a yyyy-mm-dd date as an inclusive UTC day range in epoch milliseconds. */
export function utcDayRange(date: string): { start: number; end: number } {
	const start = Date.parse(`${date}T00:00:00.000Z`);
	return { start, end: start + 24 * 60 * 60 * 1000 - 1 };
}

/**
 * Builds the Meilisearch filter string for a structured SearchFilters object.
 * The caller must have expanded `sources` / `excludeSources` to their full merge
 * groups already (expansion needs a DB lookup, which this pure helper avoids).
 * Returns undefined when no filter applies.
 */
export function buildEmailSearchFilter(filters: SearchFilters): string | undefined {
	const clauses: string[] = [];

	if (filters.sources?.length) {
		clauses.push(inClause('ingestionSourceId', filters.sources));
	}
	if (filters.excludeSources?.length) {
		clauses.push(notInClause('ingestionSourceId', filters.excludeSources));
	}
	if (filters.from?.length) {
		clauses.push(inClause('from', filters.from));
	}
	if (filters.notFrom?.length) {
		clauses.push(notInClause('from', filters.notFrom));
	}
	if (filters.to?.length) {
		// "Receiver" spans every recipient field: any of to/cc/bcc matching counts.
		const parts = ['to', 'cc', 'bcc'].map((field) => inClause(field, filters.to!));
		clauses.push(`(${parts.join(' OR ')})`);
	}
	if (filters.notTo?.length) {
		// Exclusion must hold across all recipient fields.
		const parts = ['to', 'cc', 'bcc'].map((field) => notInClause(field, filters.notTo!));
		clauses.push(`(${parts.join(' AND ')})`);
	}
	if (filters.mailboxes?.length) {
		clauses.push(inClause('userEmail', filters.mailboxes));
	}
	if (filters.dateFrom) {
		clauses.push(`timestamp >= ${utcDayRange(filters.dateFrom).start}`);
	}
	if (filters.dateTo) {
		clauses.push(`timestamp <= ${utcDayRange(filters.dateTo).end}`);
	}
	if (filters.hasAttachments === true) {
		clauses.push('hasAttachments = true');
	} else if (filters.hasAttachments === false) {
		// NOT ... = true (instead of = false) so documents indexed before the
		// hasAttachments field existed still count as attachment-less until reindexed.
		clauses.push('NOT hasAttachments = true');
	}

	return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}
