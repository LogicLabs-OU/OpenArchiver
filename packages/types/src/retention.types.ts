export interface RetentionPolicy {
	id: string;
	name: string;
	priority: number;
	conditions: Record<string, any>; // JSON condition logic
	retentionPeriodDays: number;
	isActive: boolean;
	createdAt: string; // ISO Date string
}

export interface RetentionLabel {
	id: string;
	name: string;
	retentionPeriodDays: number;
	description?: string;
	createdAt: string; // ISO Date string
}

export interface RetentionEvent {
	id: string;
	eventName: string;
	eventType: string; // e.g., 'EMPLOYEE_EXIT'
	eventTimestamp: string; // ISO Date string
	targetCriteria: Record<string, any>; // JSON criteria
	createdAt: string; // ISO Date string
}

export interface LegalHold {
	id: string;
	name: string;
	reason?: string;
	isActive: boolean;
}
