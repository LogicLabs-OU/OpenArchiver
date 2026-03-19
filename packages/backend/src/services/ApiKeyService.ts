import { randomBytes, createHash } from 'crypto';
import { db } from '../database';
import { apiKeys } from '../database/schema/api-keys';
import { CryptoService } from './CryptoService';
import { and, eq } from 'drizzle-orm';
import { ApiKey, User } from '@open-archiver/types';
import { AuditService } from './AuditService';

export class ApiKeyService {
	private static auditService = new AuditService();
	public static async generate(
		userId: string,
		name: string,
		expiresInDays: number,
		actor: User,
		actorIp: string
	): Promise<string> {
		const key = randomBytes(32).toString('hex');
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + expiresInDays);
		const keyHash = createHash('sha256').update(key).digest('hex');

		try {
			await db.insert(apiKeys).values({
				userId,
				name,
				key: CryptoService.encrypt(key),
				keyHash,
				expiresAt,
			});

			await this.auditService.createAuditLog({
				actorIdentifier: actor.id,
				actionType: 'GENERATE',
				targetType: 'ApiKey',
				targetId: name,
				actorIp,
				details: {
					keyName: name,
				},
			});

			return key;
		} catch (error) {
			throw error;
		}
	}

	public static async getKeys(userId: string): Promise<ApiKey[]> {
		const keys = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));

		return keys
			.map((apiKey) => {
				const decryptedKey = CryptoService.decrypt(apiKey.key);
				if (!decryptedKey) {
					return null;
				}
				return {
					...apiKey,
					key: decryptedKey.slice(0, 5) + '*****',
					expiresAt: apiKey.expiresAt.toISOString(),
					createdAt: apiKey.createdAt.toISOString(),
				};
			})
			.filter((k): k is NonNullable<typeof k> => k !== null);
	}

	public static async deleteKey(id: string, userId: string, actor: User, actorIp: string) {
		const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
		await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
		await this.auditService.createAuditLog({
			actorIdentifier: actor.id,
			actionType: 'DELETE',
			targetType: 'ApiKey',
			targetId: id,
			actorIp,
			details: {
				keyName: key?.name,
			},
		});
	}
	/**
	 *
	 * @param key API key
	 * @returns The owner user ID or null. null means the API key is not found.
	 */
	public static async validateKey(key: string): Promise<string | null> {
		const keyHash = createHash('sha256').update(key).digest('hex');
		const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash));
		if (!apiKey || apiKey.expiresAt < new Date()) {
			return null;
		}

		const decryptedKey = CryptoService.decrypt(apiKey.key);
		if (decryptedKey !== key) {
			// This should not happen if the hash matches, but as a security measure, we double-check.
			return null;
		}

		return apiKey.userId;
	}
}
