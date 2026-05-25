import { api } from '$lib/server/api';
import type { PageServerLoad } from './$types';
import type { SafeIngestionSource, IngestionSourceDetailedStats } from '@open-archiver/types';
import { error } from '@sveltejs/kit';
export const load: PageServerLoad = async (event) => {
	const [sourcesRes, statsRes] = await Promise.all([
		api('/ingestion-sources', event),
		api('/ingestion-sources/stats', event),
	]);

	const sourcesBody = await sourcesRes.json();
	if (!sourcesRes.ok) {
		throw error(sourcesRes.status, sourcesBody.message || 'Failed to fetch ingestions.');
	}
	const ingestionSources: SafeIngestionSource[] = sourcesBody;

	// Stats are non-critical: if they fail, render the page without them.
	let ingestionStats: IngestionSourceDetailedStats[] = [];
	if (statsRes.ok) {
		ingestionStats = await statsRes.json();
	}

	return {
		ingestionSources,
		ingestionStats,
	};
};
