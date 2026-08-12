import type { AppActions, AppSubjects, CaslPolicy } from '@open-archiver/types';
import {
	ALL_ACTIONS,
	ALL_SUBJECTS,
	catalogForSubjects,
	isMultiValueOperator,
	type Effect,
	type UiOperator,
} from './catalog';

/**
 * Conversion between stored policies and the shape the visual editor works with.
 *
 * Not every valid policy can be drawn as a list of rows. Anything the editor cannot represent
 * faithfully is reported back with a reason instead of being loaded and silently altered on save.
 */

export interface UiCondition {
	/** Local identity for keyed loops; never serialized. */
	id: string;
	field: string;
	operator: UiOperator;
	/** Single-value operators read the first entry; list operators use all of them. */
	values: string[];
}

export interface UiStatement {
	id: string;
	effect: Effect;
	actions: AppActions[];
	subjects: AppSubjects[];
	conditions: UiCondition[];
	/** Free-text note stored on the policy; blank means the property is omitted. */
	reason: string;
}

export interface UiModel {
	statements: UiStatement[];
}

/** Why a policy could not be opened in the visual editor. Codes map to translation keys. */
export type UnsupportedCode =
	| 'not_array'
	| 'not_object'
	| 'unknown_key'
	| 'fields_unsupported'
	| 'missing_action_or_subject'
	| 'invalid_action'
	| 'invalid_subject'
	| 'invalid_inverted'
	| 'invalid_reason'
	| 'conditions_not_object'
	| 'conditions_inert_subject'
	| 'conditions_wildcard_subject'
	| 'conditions_subject_conflict'
	| 'nested_operator'
	| 'multi_operator'
	| 'unknown_operator'
	| 'unknown_field'
	| 'non_string_value'
	| 'empty_value_list'
	| 'source_owner_operator';

export interface Unsupported {
	code: UnsupportedCode;
	/** 1-based position of the offending statement, for the message shown to the user. */
	statementIndex?: number;
	/** The offending key, operator or value, when naming it helps. */
	detail?: string;
}

export type ToUiResult = { ok: true; model: UiModel } | ({ ok: false } & Unsupported);

const KNOWN_POLICY_KEYS = new Set([
	'action',
	'subject',
	'conditions',
	'fields',
	'inverted',
	'reason',
]);
const OPERATOR_BY_MONGO_KEY: Record<string, UiOperator> = {
	$eq: 'eq',
	$ne: 'ne',
	$in: 'in',
	$nin: 'nin',
};

const newId = (): string =>
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const toArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

export const emptyStatement = (): UiStatement => ({
	id: newId(),
	effect: 'allow',
	actions: [],
	subjects: [],
	conditions: [],
	reason: '',
});

export const emptyCondition = (field: string, operator: UiOperator = 'eq'): UiCondition => ({
	id: newId(),
	field,
	operator,
	values: [],
});

/**
 * Reads stored policies into the editor's model, or explains why they cannot be shown visually.
 */
export function policiesToUiModel(policies: unknown): ToUiResult {
	if (!Array.isArray(policies)) {
		return { ok: false, code: 'not_array' };
	}

	const statements: UiStatement[] = [];

	for (let i = 0; i < policies.length; i += 1) {
		const at = i + 1;
		const policy = policies[i];

		if (!isPlainObject(policy)) {
			return { ok: false, code: 'not_object', statementIndex: at };
		}

		for (const key of Object.keys(policy)) {
			if (!KNOWN_POLICY_KEYS.has(key)) {
				return { ok: false, code: 'unknown_key', statementIndex: at, detail: key };
			}
		}

		// Declared on the policy type but never consulted during enforcement, so the editor has
		// no faithful way to show it.
		if ('fields' in policy) {
			return { ok: false, code: 'fields_unsupported', statementIndex: at };
		}

		if (policy.action === undefined || policy.subject === undefined) {
			return { ok: false, code: 'missing_action_or_subject', statementIndex: at };
		}

		const actions = toArray(policy.action as AppActions | AppActions[]);
		for (const action of actions) {
			if (typeof action !== 'string' || !ALL_ACTIONS.includes(action)) {
				return {
					ok: false,
					code: 'invalid_action',
					statementIndex: at,
					detail: String(action),
				};
			}
		}

		const subjects = toArray(policy.subject as AppSubjects | AppSubjects[]);
		for (const subject of subjects) {
			if (typeof subject !== 'string' || !ALL_SUBJECTS.includes(subject)) {
				return {
					ok: false,
					code: 'invalid_subject',
					statementIndex: at,
					detail: String(subject),
				};
			}
		}

		if ('inverted' in policy && typeof policy.inverted !== 'boolean') {
			return { ok: false, code: 'invalid_inverted', statementIndex: at };
		}
		if ('reason' in policy && typeof policy.reason !== 'string') {
			return { ok: false, code: 'invalid_reason', statementIndex: at };
		}

		const effect: Effect = policy.inverted === true ? 'deny' : 'allow';
		const conditions: UiCondition[] = [];

		if ('conditions' in policy && policy.conditions !== undefined) {
			if (!isPlainObject(policy.conditions)) {
				return { ok: false, code: 'conditions_not_object', statementIndex: at };
			}

			const catalog = catalogForSubjects(subjects);
			if (catalog.kind === 'inert') {
				return { ok: false, code: 'conditions_inert_subject', statementIndex: at };
			}
			if (catalog.kind === 'wildcard') {
				return { ok: false, code: 'conditions_wildcard_subject', statementIndex: at };
			}
			if (catalog.kind === 'conflict') {
				return { ok: false, code: 'conditions_subject_conflict', statementIndex: at };
			}

			for (const [key, raw] of Object.entries(policy.conditions)) {
				// A leading $ marks a grouping operator such as $or or $and, which the editor
				// draws no equivalent for.
				if (key.startsWith('$')) {
					return {
						ok: false,
						code: 'nested_operator',
						statementIndex: at,
						detail: key,
					};
				}

				const field = catalog.fields.find((f) => f.key === key);
				if (!field) {
					return { ok: false, code: 'unknown_field', statementIndex: at, detail: key };
				}

				let operator: UiOperator;
				let values: string[];

				if (isPlainObject(raw)) {
					const operatorKeys = Object.keys(raw);
					if (operatorKeys.length !== 1) {
						return {
							ok: false,
							code: 'multi_operator',
							statementIndex: at,
							detail: key,
						};
					}
					const mapped = OPERATOR_BY_MONGO_KEY[operatorKeys[0]];
					if (!mapped) {
						return {
							ok: false,
							code: 'unknown_operator',
							statementIndex: at,
							detail: operatorKeys[0],
						};
					}
					operator = mapped;
					const operand = raw[operatorKeys[0]];

					if (isMultiValueOperator(operator)) {
						if (
							!Array.isArray(operand) ||
							operand.length === 0 ||
							operand.some((v) => typeof v !== 'string')
						) {
							return {
								ok: false,
								code: 'empty_value_list',
								statementIndex: at,
								detail: key,
							};
						}
						values = operand as string[];
					} else {
						if (typeof operand !== 'string') {
							return {
								ok: false,
								code: 'non_string_value',
								statementIndex: at,
								detail: key,
							};
						}
						values = [operand];
					}
				} else {
					if (typeof raw !== 'string') {
						return {
							ok: false,
							code: 'non_string_value',
							statementIndex: at,
							detail: key,
						};
					}
					operator = 'eq';
					values = [raw];
				}

				if (!field.allowedOperators.includes(operator)) {
					return {
						ok: false,
						code: 'source_owner_operator',
						statementIndex: at,
						detail: key,
					};
				}

				conditions.push({ id: newId(), field: key, operator, values });
			}
		}

		statements.push({
			id: newId(),
			effect,
			actions,
			subjects,
			conditions,
			reason: typeof policy.reason === 'string' ? policy.reason : '',
		});
	}

	return { ok: true, model: { statements } };
}

/**
 * Writes the editor's model back to stored policies, keeping the key order and the shorthand
 * forms used throughout the documentation so hand-written and generated policies read alike.
 */
export function uiModelToPolicies(model: UiModel): CaslPolicy[] {
	return model.statements.map((statement) => {
		const policy: CaslPolicy = {} as CaslPolicy;

		if (statement.effect === 'deny') {
			policy.inverted = true;
		}

		policy.action =
			statement.actions.length === 1 ? statement.actions[0] : [...statement.actions];
		policy.subject =
			statement.subjects.length === 1 ? statement.subjects[0] : [...statement.subjects];

		if (statement.conditions.length > 0) {
			const conditions: Record<string, unknown> = {};
			for (const condition of statement.conditions) {
				// Surrounding spaces are invisible in the form but would be compared literally
				// against the stored column, so a padded value could never match.
				const values = condition.values.map((v) => v.trim()).filter((v) => v !== '');
				switch (condition.operator) {
					case 'eq':
						conditions[condition.field] = values[0] ?? '';
						break;
					case 'ne':
						conditions[condition.field] = { $ne: values[0] ?? '' };
						break;
					case 'in':
						conditions[condition.field] = { $in: values };
						break;
					case 'nin':
						conditions[condition.field] = { $nin: values };
						break;
				}
			}
			policy.conditions = conditions;
		}

		const reason = statement.reason.trim();
		if (reason) {
			policy.reason = reason;
		}

		return policy;
	});
}

export interface ValidationIssue {
	statementId: string;
	/** Absent when the problem belongs to the statement rather than one of its rows. */
	conditionId?: string;
	code:
		| 'no_actions'
		| 'no_subjects'
		| 'missing_value'
		| 'single_value_required'
		| 'field_invalid_for_subjects';
}

/**
 * Problems that must be resolved before a visually built policy can be saved.
 */
export function validateUiModel(model: UiModel): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const statement of model.statements) {
		if (statement.actions.length === 0) {
			issues.push({ statementId: statement.id, code: 'no_actions' });
		}
		if (statement.subjects.length === 0) {
			issues.push({ statementId: statement.id, code: 'no_subjects' });
		}

		const catalog = catalogForSubjects(statement.subjects);
		const fields = catalog.kind === 'fields' ? catalog.fields : [];

		for (const condition of statement.conditions) {
			const field = fields.find((f) => f.key === condition.field);
			if (!field) {
				issues.push({
					statementId: statement.id,
					conditionId: condition.id,
					code: 'field_invalid_for_subjects',
				});
				continue;
			}

			const filled = condition.values.filter((v) => v.trim() !== '');
			if (filled.length === 0) {
				issues.push({
					statementId: statement.id,
					conditionId: condition.id,
					code: 'missing_value',
				});
			} else if (!isMultiValueOperator(condition.operator) && filled.length > 1) {
				issues.push({
					statementId: statement.id,
					conditionId: condition.id,
					code: 'single_value_required',
				});
			}
		}
	}

	return issues;
}
