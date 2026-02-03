import { api } from '$lib/server/api';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { GetAuditLogsResponse } from '@open-archiver/types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		throw error(
			403,
			'This feature is only available in the Enterprise Edition. Please contact Open Archiver to upgrade.'
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
