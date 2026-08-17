import { api } from '$lib/server/api';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { GetAuditLogsResponse } from '@open-archiver/types';
import { error } from '@sveltejs/kit';
import { enterpriseOnly } from '$lib/server/enterprise-gate';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		enterpriseOnly(
			'app.audit_log.title',
			'app.components.enterprise_feature_notice.pitch.audit_log'
		);
	}
	// Forward search params from the page URL to the API request
	const response = await api(
		`/enterprise/audit-logs?${event.url.searchParams.toString()}`,
		event
	);
	const res = await response.json();
	if (!response.ok) {
		throw error(response.status, res.message || JSON.stringify(res));
	}

	const result: GetAuditLogsResponse = res;
	return {
		logs: result.data,
		meta: result.meta,
	};
};
