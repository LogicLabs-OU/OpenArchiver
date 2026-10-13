import { api } from '$lib/server/api';
import { enterpriseOnly } from '$lib/server/enterprise-gate';
import { error, isHttpError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Role, SsoConnection } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		enterpriseOnly('app.layout.sso', 'app.components.enterprise_feature_notice.pitch.sso');
	}

	try {
		const [connectionsRes, rolesRes, redirectRes] = await Promise.all([
			api('/enterprise/sso/connections', event),
			api('/iam/roles', event),
			api('/enterprise/sso/redirect-uri', event),
		]);

		if (!connectionsRes.ok) {
			// The refusal reaches the browser as the server sent it: a user without
			// Super Admin gets 403, and so does an instance whose licence no longer
			// covers SSO. Answering either with 500 hides a configuration problem
			// behind what looks like a crash. The body may be empty on a refusal
			// from an intermediary, hence the fallback message.
			const body = await connectionsRes.json().catch(() => ({}) as { message?: string });
			throw error(
				connectionsRes.status,
				body.message || 'Failed to load single sign-on configuration'
			);
		}

		const connections: SsoConnection[] = await connectionsRes.json();
		const roles: Role[] = rolesRes.ok ? await rolesRes.json() : [];
		// The values an administrator has to paste into the identity provider. They
		// are derived from APP_URL server-side, so showing them here saves guessing.
		const {
			redirectUri,
			samlMetadataUrl,
			samlAcsUrl,
		}: { redirectUri: string; samlMetadataUrl: string; samlAcsUrl: string } = redirectRes.ok
			? await redirectRes.json()
			: { redirectUri: '', samlMetadataUrl: '', samlAcsUrl: '' };

		return { connections, roles, redirectUri, samlMetadataUrl, samlAcsUrl };
	} catch (e) {
		// `error()` throws an HttpError, which is not an Error subclass — testing for
		// one with `instanceof Error` is always false and turned every refusal above
		// into a 500. `isHttpError` is the check that actually holds.
		if (isHttpError(e)) throw e;
		throw error(500, 'An unexpected error occurred while loading single sign-on settings.');
	}
};
