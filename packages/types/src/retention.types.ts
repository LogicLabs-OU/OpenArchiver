// --- Condition Builder Types ---

export type ConditionField = 'sender' | 'recipient' | 'subject' | 'attachment_type';

/**
 * All supported string-matching operators for retention rule conditions.
 * - equals / not_equals:   exact case-insensitive match
 * - contains / not_contains: substring match
 * - starts_with:           prefix match
 * - ends_with:             suffix match
 * - domain_match:          email address ends with @<domain>
 * - regex_match:           ECMAScript regex (server-side only, length-limited for safety)
 */
export type ConditionOperator =
	| 'equals'
	| 'not_equals'
	| 'contains'
	| 'not_contains'
	| 'starts_with'
	| 'ends_with'
	| 'domain_match'
	| 'regex_match';

export type LogicalOperator = 'AND' | 'OR';

export interface RetentionRule {
	field: ConditionField;
	operator: ConditionOperator;
	value: string;
}

export interface RetentionRuleGroup {
	logicalOperator: LogicalOperator;
	rules: RetentionRule[];
}

// --- Policy Evaluation Types ---

export interface PolicyEvaluationRequest {
	emailMetadata: {
		sender: string;
		recipients: string[];
		subject: string;
		attachmentTypes: string[]; // e.g. ['.pdf', '.xml']
		/** Optional ingestion source ID to scope the evaluation. */
		ingestionSourceId?: string;
	};
}

export interface PolicyEvaluationResult {
	appliedRetentionDays: number;
	actionOnExpiry: 'delete_permanently';
	matchingPolicyIds: string[];
}

// --- Entity Types ---

export interface RetentionPolicy {
	id: string;
	name: string;
	description?: string;
	priority: number;
	conditions: RetentionRuleGroup | null;
	/**
	 * Restricts the policy to specific ingestion sources.
	 * null means the policy applies to all ingestion sources.
	 */
	ingestionScope: string[] | null;
	retentionPeriodDays: number;
	isActive: boolean;
	createdAt: string; // ISO Date string
	updatedAt: string; // ISO Date string
}

export interface RetentionLabel {
	id: string;
	name: string;
	retentionPeriodDays: number;
	description?: string;
	isDisabled: boolean;
	/**
	 * Number of archived emails that currently have this label applied.
	 * Used by the management UI to show usage and decide whether deletion
	 * is a hard-delete (0) or a soft-disable (> 0).
	 */
	appliedEmailCount: number;
	createdAt: string; // ISO Date string
}

/** The retention label currently applied to an archived email. */
export interface EmailRetentionLabelInfo {
	labelId: string;
	labelName: string;
	retentionPeriodDays: number;
	appliedAt: string; // ISO Date string
	appliedByUserId: string | null;
	/** True when the label itself has been soft-disabled (isDisabled = true on the label row). */
	isLabelDisabled: boolean;
}

export interface RetentionEvent {
	id: string;
	eventName: string;
	eventType: string; // e.g., 'EMPLOYEE_EXIT'
	eventTimestamp: string; // ISO Date string
	targetCriteria: Record<string, unknown>; // JSON criteria
	createdAt: string; // ISO Date string
}

export interface LegalHold {
	id: string;
	name: string;
	reason?: string;
	isActive: boolean;
	caseId?: string | null;
	/** Number of emails currently under this hold. */
	emailCount: number;
	createdAt: string; // ISO Date string
	updatedAt: string; // ISO Date string
}

/** Info about a legal hold applied to a specific email. */
export interface EmailLegalHoldInfo {
	legalHoldId: string;
	holdName: string;
	isActive: boolean;
	appliedAt: string; // ISO Date string
	appliedByUserId: string | null;
}

/** Result returned after applying a hold to emails via bulk query. */
export interface BulkApplyHoldResult {
	legalHoldId: string;
	emailsLinked: number;
	queryUsed: Record<string, unknown>;
}
