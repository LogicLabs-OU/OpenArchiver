import { db, Database } from '../database';
import * as schema from '../database/schema';
import {
	AuditLogEntry,
	CreateAuditLogEntry,
	GetAuditLogsOptions,
	GetAuditLogsResponse,
} from '@open-archiver/types';
import { desc, sql, asc, and, gte, lte, eq } from 'drizzle-orm';
import { createHash } from 'crypto';

export class AuditService {
	private sanitizeObject(obj: any): any {
		if (obj === null || typeof obj !== 'object') {
			return obj;
		}
		if (Array.isArray(obj)) {
			return obj.map((item) => this.sanitizeObject(item));
		}
		const sanitizedObj: { [key: string]: any } = {};
		for (const key in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, key)) {
				const value = obj[key];
				sanitizedObj[key] = value === undefined ? null : this.sanitizeObject(value);
			}
		}
		return sanitizedObj;
	}

	public async createAuditLog(entry: CreateAuditLogEntry) {
		return db.transaction(async (tx) => {
			// Lock the table to prevent race conditions
			await tx.execute(sql`LOCK TABLE audit_logs IN EXCLUSIVE MODE`);

			const sanitizedEntry = this.sanitizeObject(entry);

			const previousHash = await this.getLatestHash(tx);
			const newEntry = {
				...sanitizedEntry,
				previousHash,
				timestamp: new Date(),
			};
			const currentHash = this.calculateHash(newEntry);

			const finalEntry = {
				...newEntry,
				currentHash,
			};

			await tx.insert(schema.auditLogs).values(finalEntry);

			return finalEntry;
		});
	}

	private async getLatestHash(tx: Database): Promise<string | null> {
		const [latest] = await tx
			.select({
				currentHash: schema.auditLogs.currentHash,
			})
			.from(schema.auditLogs)
			.orderBy(desc(schema.auditLogs.id))
			.limit(1);

		return latest?.currentHash ?? null;
	}

	private calculateHash(entry: any): string {
		// Create a canonical object for hashing to ensure consistency in property order and types.
		const objectToHash = {
			actorIdentifier: entry.actorIdentifier,
			actorIp: entry.actorIp ?? null,
			actionType: entry.actionType,
			targetType: entry.targetType ?? null,
			targetId: entry.targetId ?? null,
			details: entry.details ?? null,
			previousHash: entry.previousHash ?? null,
			// Normalize timestamp to milliseconds since epoch to avoid precision issues.
			timestamp: new Date(entry.timestamp).getTime(),
		};

		const data = this.canonicalStringify(objectToHash);
		return createHash('sha256').update(data).digest('hex');
	}

	private canonicalStringify(obj: any): string {
		if (obj === undefined) {
			return 'null';
		}
		if (obj === null || typeof obj !== 'object') {
			return JSON.stringify(obj);
		}

		if (Array.isArray(obj)) {
			return `[${obj.map((item) => this.canonicalStringify(item)).join(',')}]`;
		}

		const keys = Object.keys(obj).sort();
		const pairs = keys.map((key) => {
			const value = obj[key];
			return `${JSON.stringify(key)}:${this.canonicalStringify(value)}`;
		});
		return `{${pairs.join(',')}}`;
	}

	public async getAuditLogs(options: GetAuditLogsOptions = {}): Promise<GetAuditLogsResponse> {
		const {
			page = 1,
			limit = 20,
			startDate,
			endDate,
			actor,
			actionType,
			sort = 'desc',
		} = options;

		const whereClauses = [];
		if (startDate) whereClauses.push(gte(schema.auditLogs.timestamp, startDate));
		if (endDate) whereClauses.push(lte(schema.auditLogs.timestamp, endDate));
		if (actor) whereClauses.push(eq(schema.auditLogs.actorIdentifier, actor));
		if (actionType) whereClauses.push(eq(schema.auditLogs.actionType, actionType));

		const where = and(...whereClauses);

		const logs = await db.query.auditLogs.findMany({
			where,
			orderBy: [sort === 'asc' ? asc(schema.auditLogs.id) : desc(schema.auditLogs.id)],
			limit,
			offset: (page - 1) * limit,
		});

		const totalResult = await db
			.select({
				count: sql<number>`count(*)`,
			})
			.from(schema.auditLogs)
			.where(where);

		const total = totalResult[0].count;

		return {
			data: logs as AuditLogEntry[],
			meta: {
				total,
				page,
				limit,
			},
		};
	}

	public async verifyAuditLog(): Promise<{ ok: boolean; message: string; logId?: number }> {
		const chunkSize = 1000;
		let offset = 0;
		let previousHash: string | null = null;
		/**
		 * TODO: create job for audit log verification, generate audit report (new DB table)
		 */
		while (true) {
			const logs = await db.query.auditLogs.findMany({
				orderBy: [asc(schema.auditLogs.id)],
				limit: chunkSize,
				offset,
			});

			if (logs.length === 0) {
				break;
			}

			for (const log of logs) {
				if (log.previousHash !== previousHash) {
					return {
						ok: false,
						message: 'Audit log chain is broken!',
						logId: log.id,
					};
				}

				const calculatedHash = this.calculateHash(log);

				if (log.currentHash !== calculatedHash) {
					return {
						ok: false,
						message: 'Audit log entry is tampered!',
						logId: log.id,
					};
				}
				previousHash = log.currentHash;
			}

			offset += chunkSize;
		}

		return {
			ok: true,
			message:
				'Audit log integrity verified successfully. The logs are not tempered with and the log chain is complete.',
		};
	}
}
