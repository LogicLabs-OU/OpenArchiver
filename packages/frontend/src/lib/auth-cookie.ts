import { dev } from '$app/environment';

export const ACCESS_TOKEN_COOKIE_BASE = 'accessToken';

/**
 * Port-scoped auth cookie name, applied in development only. Browsers key cookies by host and
 * ignore the port, so two dev instances on the same host (OSS on :3003 and Enterprise on :3005)
 * would otherwise share one `accessToken` cookie and clobber each other's session.
 *
 * The suffix must never apply outside development. The cookie is written in the browser from
 * `window.location.port` but read on the server from `event.url.port`, which adapter-node takes
 * from the `ORIGIN` environment variable (falling back to the `Host` header). Those two ports are
 * unrelated: with the documented `ORIGIN=$APP_URL` default of `http://localhost:3000`, the server
 * always looks for `accessToken_3000` while a browser on `https://archive.example.com` writes
 * `accessToken`. The lookup misses, the session reads as signed out, and every request bounces to
 * /signin — see issue #436. In development both sides talk to the same Vite server, so the ports
 * always agree and the suffix is safe.
 */
export function accessTokenCookieName(port: string): string {
	return dev && port ? `${ACCESS_TOKEN_COOKIE_BASE}_${port}` : ACCESS_TOKEN_COOKIE_BASE;
}
