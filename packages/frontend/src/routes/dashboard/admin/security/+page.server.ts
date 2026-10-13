import { api } from '$lib/server/api';
import { enterpriseOnly } from '$lib/server/enterprise-gate';
import { error, isHttpError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { AdvancedSecurityPolicy } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		enterpriseOnly(
			'app.layout.security_policy',
			'app.components.enterprise_feature_notice.pitch.security_policy'
		);
	}

	try {
		const response = await api('/enterprise/advanced-security/policy', event);

		if (!response.ok) {
			// Same reasoning as the SSO page: pass the server's own status and
			// message through rather than flattening a permission or licence
			// refusal into a 500.
			const body = await response.json().catch(() => ({}) as { message?: string });
			throw error(response.status, body.message || 'Failed to fetch security policy');
		}

		const policy: AdvancedSecurityPolicy = await response.json();
		return { policy };
	} catch (e) {
		// HttpError does not extend Error, so `instanceof Error` never matched here
		// and every refusal above was rewritten as a 500.
		if (isHttpError(e)) throw e;
		throw error(500, 'An unexpected error occurred while loading the security policy.');
	}
};
