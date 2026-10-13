import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from '../../config';

const windowInMinutes = Math.ceil(config.api.rateLimit.windowMs / 60000);

export const rateLimiter = rateLimit({
	windowMs: config.api.rateLimit.windowMs,
	max: config.api.rateLimit.max,
	keyGenerator: (req, res) => {
		// Use the real IP address of the client, even if it's behind a proxy.
		// `app.set('trust proxy', true)` in `server.ts`.
		return ipKeyGenerator(req.ip || 'unknown');
	},
	message: {
		status: 429,
		message: `Too many requests from this IP, please try again after ${windowInMinutes} minutes`,
	},
	statusCode: 429,
	standardHeaders: true,
	legacyHeaders: false,
});

/**
 * Limiter for the pre-authentication MFA challenge: the login `/verify` endpoint and
 * the enterprise forced-enrollment pair.
 *
 * Keyed by IP, because there is no authenticated user yet — which means one office
 * behind a single address shares this budget. 100 per 15 minutes leaves room for a
 * floor of real logins while still bounding a guessing attack: the attacker already
 * needs the password, the `mfaPending` cookie they must present expires after five
 * minutes, and every failed attempt writes an `MFA_VERIFY_FAIL` audit entry.
 */
export const mfaChallengeLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 100,
	message: {
		status: 429,
		message: 'Too many MFA verification attempts. Please try again later.',
	},
	standardHeaders: true,
	legacyHeaders: false,
	// trust proxy is set to `true` globally for correct IP forwarding in production.
	// express-rate-limit v8 warns about this; we acknowledge it here.
	validate: { trustProxy: false },
});

/**
 * Limiter for the authenticated MFA management endpoints — setup, enroll, disable and
 * backup-code regeneration.
 *
 * Keyed by user rather than by address. `requireAuth` runs before this middleware on
 * every route that mounts it, so `req.user.sub` is always set in practice. Two things
 * follow: colleagues behind one NAT no longer consume each other's budget, and an
 * attacker holding a stolen JWT cannot reset the budget by changing IP — which the
 * per-address form allowed. The IP fallback covers only the case of this limiter being
 * mounted without an auth guard ahead of it.
 *
 * `ipKeyGenerator` in that fallback is required, not decorative: v8 refuses a custom
 * key generator that reads `req.ip` without it, because raw IPv6 addresses let a
 * caller walk their own subnet to evade the limit.
 */
export const mfaManagementLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 10,
	keyGenerator: (req) => req.user?.sub ?? ipKeyGenerator(req.ip || 'unknown'),
	message: {
		status: 429,
		message: 'Too many MFA verification attempts. Please try again later.',
	},
	standardHeaders: true,
	legacyHeaders: false,
	validate: { trustProxy: false },
});
