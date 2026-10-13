import Redis from 'ioredis';
import { config } from '../config';

const KEY_PREFIX_SETUP = 'mfa:setup:';
const KEY_PREFIX_USED_TOKEN = 'mfa:used:';

/** Default TTL for pending TOTP secrets during enrollment (10 minutes). */
const SETUP_SECRET_TTL_MS = 600_000;

/** Default TTL for used TOTP tokens to prevent replay (90 seconds). */
const USED_TOKEN_TTL_S = 90;

interface InMemoryEntry {
	value: string;
	expiresAt: number;
}

/**
 * Thin Redis wrapper for MFA-related ephemeral data.
 * Handles pending enrollment secrets and TOTP replay prevention.
 *
 * Falls back to an in-memory TTL map when Redis is unavailable (e.g. local dev
 * without a running Redis instance). The in-memory fallback is process-local and
 * not suitable for multi-instance deployments — ensure Redis is available in
 * production.
 */
export class MfaRedisStore {
	#redis: Redis | null = null;
	#redisAvailable = false;

	/** In-memory fallback stores used when Redis is unreachable. */
	#memSetup = new Map<string, InMemoryEntry>();
	#memUsed = new Map<string, InMemoryEntry>();

	constructor() {
		try {
			// Extract only primitive fields to avoid type mismatch between BullMQ's
			// ConnectionOptions and ioredis RedisOptions.
			const { host, port, password, username } = config.redis;
			const client = new Redis({
				host,
				port,
				password,
				username,
				// Do not retry indefinitely — fail fast and fall back to in-memory.
				maxRetriesPerRequest: 1,
				retryStrategy: () => null,
				lazyConnect: true,
			});

			client.on('ready', () => {
				this.#redisAvailable = true;
			});

			client.on('error', () => {
				this.#redisAvailable = false;
			});

			// Attempt a non-blocking connection; ignore failures.
			client.connect().catch(() => {
				this.#redisAvailable = false;
			});

			this.#redis = client;
		} catch {
			// Redis config missing or invalid — stay in in-memory mode.
			this.#redis = null;
			this.#redisAvailable = false;
		}
	}

	// ── Internal helpers ─────────────────────────────────────────────────────

	#memGet(store: Map<string, InMemoryEntry>, key: string): string | null {
		const entry = store.get(key);
		if (!entry) return null;
		if (Date.now() > entry.expiresAt) {
			store.delete(key);
			return null;
		}
		return entry.value;
	}

	#memSet(store: Map<string, InMemoryEntry>, key: string, value: string, ttlMs: number): void {
		store.set(key, { value, expiresAt: Date.now() + ttlMs });
	}

	#memDel(store: Map<string, InMemoryEntry>, key: string): void {
		store.delete(key);
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Stores the generated TOTP secret for a user during the enrollment setup flow.
	 * Automatically expires after `ttlSeconds` (default 10 minutes).
	 */
	public async storePendingSecret(
		userId: string,
		secret: string,
		ttlSeconds: number = SETUP_SECRET_TTL_MS / 1000
	): Promise<void> {
		const key = `${KEY_PREFIX_SETUP}${userId}`;
		if (this.#redisAvailable && this.#redis) {
			try {
				await this.#redis.set(key, secret, 'EX', ttlSeconds);
				return;
			} catch {
				this.#redisAvailable = false;
			}
		}
		this.#memSet(this.#memSetup, key, secret, ttlSeconds * 1000);
	}

	/** Retrieves the pending TOTP secret for a user. Returns null if expired or missing. */
	public async getPendingSecret(userId: string): Promise<string | null> {
		const key = `${KEY_PREFIX_SETUP}${userId}`;
		if (this.#redisAvailable && this.#redis) {
			try {
				return await this.#redis.get(key);
			} catch {
				this.#redisAvailable = false;
			}
		}
		return this.#memGet(this.#memSetup, key);
	}

	/** Deletes the pending TOTP secret after successful enrollment. */
	public async deletePendingSecret(userId: string): Promise<void> {
		const key = `${KEY_PREFIX_SETUP}${userId}`;
		if (this.#redisAvailable && this.#redis) {
			try {
				await this.#redis.del(key);
				return;
			} catch {
				this.#redisAvailable = false;
			}
		}
		this.#memDel(this.#memSetup, key);
	}

	/**
	 * Records a TOTP token as "used" for a given user to prevent replay within the same time window.
	 * The key automatically expires after `ttlSeconds` (default 90s — covers current + adjacent windows).
	 */
	public async storeUsedToken(
		userId: string,
		token: string,
		ttlSeconds: number = USED_TOKEN_TTL_S
	): Promise<void> {
		const key = `${KEY_PREFIX_USED_TOKEN}${userId}:${token}`;
		if (this.#redisAvailable && this.#redis) {
			try {
				await this.#redis.set(key, '1', 'EX', ttlSeconds);
				return;
			} catch {
				this.#redisAvailable = false;
			}
		}
		this.#memSet(this.#memUsed, key, '1', ttlSeconds * 1000);
	}

	/** Checks whether a TOTP token was already used by this user within the replay window. */
	public async isTokenUsed(userId: string, token: string): Promise<boolean> {
		const key = `${KEY_PREFIX_USED_TOKEN}${userId}:${token}`;
		if (this.#redisAvailable && this.#redis) {
			try {
				const result = await this.#redis.exists(key);
				return result === 1;
			} catch {
				this.#redisAvailable = false;
			}
		}
		return this.#memGet(this.#memUsed, key) !== null;
	}
}

/** Singleton instance shared by MfaService. */
export const mfaRedisStore = new MfaRedisStore();
