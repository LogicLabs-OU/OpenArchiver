import type { AuditLogAction, AuditLogTargetType } from './audit-log.enums';

export interface AuditLogEntry {
	id: number;
	previousHash: string | null;
	timestamp: Date;
	actorIdentifier: string;
	actorIp: string | null;
	actionType: AuditLogAction;
	targetType: AuditLogTargetType | null;
	targetId: string | null;
	details: Record<string, any> | null;
	currentHash: string;
}

export type CreateAuditLogEntry = Omit<
	AuditLogEntry,
	'id' | 'previousHash' | 'timestamp' | 'currentHash'
>;

export interface GetAuditLogsOptions {
	page?: number;
	limit?: number;
	startDate?: Date;
	endDate?: Date;
	actor?: string;
	actionType?: AuditLogAction;
	targetType?: AuditLogTargetType | null;
	sort?: 'asc' | 'desc';
}

export interface GetAuditLogsResponse {
	data: AuditLogEntry[];
	meta: {
		total: number;
		page: number;
		limit: number;
	};
}
