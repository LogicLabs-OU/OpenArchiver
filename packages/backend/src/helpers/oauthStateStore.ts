/**
 * Server-side OAuth state store backed by Valkey (Redis-compatible).
 *
 * Each pending OAuth flow is stored as:
 *   Key:   oauth:state:<state-uuid>
 *   Value: JSON { userId, codeVerifier }
 *   TTL:   10 minutes
 *
 * `consumeOAuthState` is atomic (Lua EVAL GET+DEL) so the state token works
 * exactly once and cannot be replayed even under concurrent requests.
 */
import Redis from 'ioredis';
import { connection as redisOptions } from '../config/redis';

const STATE_TTL_SECONDS = 600; // 10 minutes
const KEY_PREFIX = 'oauth:state:';

interface OAuthStatePayload {
	userId: string;
	codeVerifier: string;
}

// Lazy singleton client dedicated to OAuth state.  Using a separate instance
// avoids interfering with bullmq's connection management.
let _client: Redis | null = null;

function getClient(): Redis {
	if (!_client) {
		_client = new Redis({
			host: redisOptions.host,
			port: redisOptions.port,
			password: redisOptions.password,
			tls: redisOptions.tls,
			// Do not block the process if Valkey is briefly unavailable
			lazyConnect: true,
			maxRetriesPerRequest: 3,
		});
	}
	return _client;
}

/**
 * Persist an OAuth state token together with the userId and codeVerifier.
 * The token expires after {@link STATE_TTL_SECONDS} seconds.
 */
export async function saveOAuthState(
	state: string,
	userId: string,
	codeVerifier: string
): Promise<void> {
	const payload: OAuthStatePayload = { userId, codeVerifier };
	await getClient().set(KEY_PREFIX + state, JSON.stringify(payload), 'EX', STATE_TTL_SECONDS);
}

/**
 * Atomically retrieve **and delete** the OAuth state entry using a Lua script.
 * The Lua EVAL ensures GET+DEL is truly atomic, preventing double-consumption
 * under concurrent requests (unlike a plain pipeline which only batches the
 * round-trip but does not guarantee atomicity).
 * Returns `null` if the state does not exist or has already been consumed.
 */
export async function consumeOAuthState(state: string): Promise<OAuthStatePayload | null> {
	const key = KEY_PREFIX + state;
	const client = getClient();

	// Lua script: atomically GET and DEL the key in a single operation.
	const raw = await client.eval(
		`local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v`,
		1,
		key
	) as string | null;
	if (!raw) {
		return null;
	}

	try {
		return JSON.parse(raw) as OAuthStatePayload;
	} catch {
		return null;
	}
}
