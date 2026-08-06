import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { AdvancedSecurityPolicy } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		throw error(
			403,
			'Advanced security settings are only available in the Enterprise Edition.'
		);
	}

	try {
		const response = await api('/enterprise/advanced-security/policy', event);

		if (!response.ok) {
			if (response.status === 403) {
				throw error(403, 'You do not have permission to manage security policy.');
			}
			throw error(response.status, 'Failed to fetch security policy');
		}

		const policy: AdvancedSecurityPolicy = await response.json();
		return { policy };
	} catch (e) {
		if (e instanceof Error && 'status' in e) throw e;
		throw error(500, 'An unexpected error occurred while loading the security policy.');
	}
};
