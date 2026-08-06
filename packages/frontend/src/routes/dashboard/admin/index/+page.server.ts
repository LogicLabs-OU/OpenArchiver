import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { SearchInstanceOverview, SearchTasksResult } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	const status = event.url.searchParams.get('status') || '';
	const from = event.url.searchParams.get('from') || '';
	const limit = event.url.searchParams.get('limit') || '20';

	const params = new URLSearchParams();
	params.set('limit', limit);
	if (from) params.set('from', from);
	if (status) params.set('statuses', status);

	const [overviewRes, tasksRes] = await Promise.all([
		api('/index-admin/overview', event),
		api(`/index-admin/tasks?${params.toString()}`, event),
	]);

	if (!overviewRes.ok) {
		const body = await overviewRes.json().catch(() => ({}));
		throw error(overviewRes.status, body.message || 'Failed to load search engine overview.');
	}
	if (!tasksRes.ok) {
		const body = await tasksRes.json().catch(() => ({}));
		throw error(tasksRes.status, body.message || 'Failed to load search engine tasks.');
	}

	const overview: SearchInstanceOverview = await overviewRes.json();
	const tasks: SearchTasksResult = await tasksRes.json();

	return { overview, tasks, filters: { status, limit, from } };
};
