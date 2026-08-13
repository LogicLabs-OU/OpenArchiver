import type { CaslPolicy } from '@open-archiver/types';
import { normalizeEmailAddress } from '../helpers/emailAddress';

/**
 * Condition fields that hold an email address. Addresses are one identity regardless of letter
 * case or surrounding whitespace, so a policy naming `orders@example.com` must also match a row
 * stored as `Orders@Example.com` or a value pasted in as ` orders@example.com `.
 */
const EMAIL_CONDITION_KEYS = new Set(['userEmail']);

/** Mongo operators whose operand is a plain value rather than a nested condition object. */
const VALUE_OPERATORS = new Set(['$eq', '$ne']);

/** Mongo operators whose operand is an array of plain values. */
const ARRAY_OPERATORS = new Set(['$in', '$nin']);

/** Mongo operators that group nested condition objects. */
const LOGICAL_ARRAY_OPERATORS = new Set(['$or', '$and', '$nor']);

const normalize = (value: unknown): unknown =>
	typeof value === 'string' ? normalizeEmailAddress(value) : value;

/**
 * Normalizes the operand of a single email condition, whatever shape it takes:
 * a bare value, `{ $eq | $ne: value }`, or `{ $in | $nin: [values] }`.
 */
function normalizeEmailOperand(operand: unknown): unknown {
	if (Array.isArray(operand)) {
		return operand.map(normalize);
	}

	if (operand && typeof operand === 'object') {
		const normalized: Record<string, unknown> = {};
		for (const [operator, value] of Object.entries(operand as Record<string, unknown>)) {
			if (VALUE_OPERATORS.has(operator)) {
				normalized[operator] = normalize(value);
			} else if (ARRAY_OPERATORS.has(operator)) {
				normalized[operator] = Array.isArray(value)
					? value.map(normalize)
					: normalize(value);
			} else {
				// $exists and anything else: the operand is not an address, leave it alone.
				normalized[operator] = value;
			}
		}
		return normalized;
	}

	return normalize(operand);
}

function normalizeConditions(conditions: Record<string, any>): Record<string, any> {
	const normalized: Record<string, any> = {};

	for (const [key, value] of Object.entries(conditions)) {
		if (LOGICAL_ARRAY_OPERATORS.has(key)) {
			normalized[key] = Array.isArray(value) ? value.map(normalizeConditions) : value;
			continue;
		}

		if (key === '$not') {
			normalized[key] =
				value && typeof value === 'object' ? normalizeConditions(value) : value;
			continue;
		}

		normalized[key] = EMAIL_CONDITION_KEYS.has(key) ? normalizeEmailOperand(value) : value;
	}

	return normalized;
}

/**
 * Returns the policies with every email-address condition lowercased.
 *
 * The same policy is enforced by three engines with different case semantics: Meilisearch
 * string filters ignore case, while CASL's instance check and the Postgres query compare
 * exactly. Without this, a mailbox-scoped role finds an email in search but is denied when
 * opening it — issue #439. Applies to deny (`inverted`) rules as well, since those are also
 * conditioned on mailbox addresses.
 *
 * Only email-address fields are touched. Fields such as `name`, `status` and `provider` are
 * legitimately case-sensitive and pass through unchanged.
 */
export function normalizeEmailConditions(policies: CaslPolicy[]): CaslPolicy[] {
	return policies.map((policy) =>
		policy.conditions
			? { ...policy, conditions: normalizeConditions(policy.conditions) }
			: policy
	);
}
