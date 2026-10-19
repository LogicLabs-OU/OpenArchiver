import type { SearchFilters } from '@open-archiver/types';
import { splitEmailAddress } from './emailAddress';

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

/**
 * `NOT field = "x"` for one value, `field NOT IN ["x", "y"]` for several.
 *
 * Not `field != "x"`: Meilisearch answers that with no documents at all while no document in the
 * index has the field yet, which is the state of a newly added field (such as the address halves
 * behind `*@domain`) until the first email carrying it is indexed. Once the field exists the two
 * forms return the same documents.
 */
export function notInClause(field: string, values: string[]): string {
	if (values.length === 1) {
		return `NOT ${field} = ${quoteMeiliString(values[0])}`;
	}
	return `${field} NOT IN [${values.map(quoteMeiliString).join(', ')}]`;
}

/** Parses a yyyy-mm-dd date as an inclusive UTC day range in epoch milliseconds. */
export function utcDayRange(date: string): { start: number; end: number } {
	const start = Date.parse(`${date}T00:00:00.000Z`);
	return { start, end: start + 24 * 60 * 60 * 1000 - 1 };
}

/** How one value of an address filter is matched. */
export type AddressPattern =
	| { kind: 'exact'; value: string }
	| { kind: 'domain'; value: string }
	| { kind: 'localPart'; value: string };

/**
 * Reads the two wildcard forms an address filter accepts (#438): `*@domain` for every address at
 * that domain and `name@*` for that local part at any domain. A value without `*` is matched as it
 * is. Any other use of `*` is unsupported and yields undefined, so the controller can reject it
 * before it reaches the engine as a literal that matches nothing.
 */
export function parseAddressPattern(value: string): AddressPattern | undefined {
	if (!value.includes('*')) {
		return { kind: 'exact', value };
	}
	const parts = splitEmailAddress(value);
	if (!parts) {
		return undefined;
	}
	if (parts.localPart === '*' && !parts.domain.includes('*')) {
		return { kind: 'domain', value: parts.domain };
	}
	if (parts.domain === '*' && !parts.localPart.includes('*')) {
		return { kind: 'localPart', value: parts.localPart };
	}
	return undefined;
}

/** The index fields one address filter is matched against. */
interface AddressFields {
	/** Fields holding whole addresses; several for the recipient filter, which spans to, cc and bcc. */
	exact: string[];
	domain: string;
	localPart: string;
}

const FROM_FIELDS: AddressFields = {
	exact: ['from'],
	domain: 'fromDomain',
	localPart: 'fromLocalPart',
};
const RECIPIENT_FIELDS: AddressFields = {
	exact: ['to', 'cc', 'bcc'],
	domain: 'recipientDomains',
	localPart: 'recipientLocalParts',
};
const MAILBOX_FIELDS: AddressFields = {
	exact: ['userEmail'],
	domain: 'userEmailDomain',
	localPart: 'userEmailLocalPart',
};

/**
 * One self-parenthesized clause for an address filter: each value goes to the field its pattern
 * names, and the per-field clauses are OR-ed to include (any may match) or AND-ed to exclude (none
 * may match). A value the controller should have rejected is matched as a literal, which is what
 * every value was before wildcards existed.
 */
function addressClauses(values: string[], fields: AddressFields, exclude: boolean): string {
	const byKind: Record<AddressPattern['kind'], string[]> = {
		exact: [],
		domain: [],
		localPart: [],
	};
	for (const value of values) {
		const pattern = parseAddressPattern(value) ?? { kind: 'exact', value };
		byKind[pattern.kind].push(pattern.value);
	}

	const clause = exclude ? notInClause : inClause;
	const parts: string[] = [];
	if (byKind.exact.length > 0) {
		parts.push(...fields.exact.map((field) => clause(field, byKind.exact)));
	}
	if (byKind.domain.length > 0) {
		parts.push(clause(fields.domain, byKind.domain));
	}
	if (byKind.localPart.length > 0) {
		parts.push(clause(fields.localPart, byKind.localPart));
	}
	return `(${parts.join(exclude ? ' AND ' : ' OR ')})`;
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
		clauses.push(addressClauses(filters.from, FROM_FIELDS, false));
	}
	if (filters.notFrom?.length) {
		clauses.push(addressClauses(filters.notFrom, FROM_FIELDS, true));
	}
	if (filters.to?.length) {
		// "Receiver" spans every recipient field: any of to/cc/bcc matching counts.
		clauses.push(addressClauses(filters.to, RECIPIENT_FIELDS, false));
	}
	if (filters.notTo?.length) {
		// Exclusion must hold across all recipient fields.
		clauses.push(addressClauses(filters.notTo, RECIPIENT_FIELDS, true));
	}
	if (filters.mailboxes?.length) {
		clauses.push(addressClauses(filters.mailboxes, MAILBOX_FIELDS, false));
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
