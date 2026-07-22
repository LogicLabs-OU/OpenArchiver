export const ACCESS_TOKEN_COOKIE_BASE = 'accessToken';

/**
 * Port-scoped auth cookie name. Browsers key cookies by host only (not port), so two
 * instances on the same host (e.g. OSS on :3003 and Enterprise on :3005 during local dev)
 * would otherwise share one `accessToken` cookie and clobber each other's session. Scoping
 * the name by the instance's own port keeps them separate. An empty port (production on
 * 80/443) yields the bare `accessToken`, so existing sessions are unaffected.
 */
export function accessTokenCookieName(port: string): string {
	return port ? `${ACCESS_TOKEN_COOKIE_BASE}_${port}` : ACCESS_TOKEN_COOKIE_BASE;
}
