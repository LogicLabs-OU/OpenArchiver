import { api } from '$lib/server/api';
import type { PageServerLoad } from './$types';
import type { IngestionSource } from '@open-archiver/types';
import { error } from '@sveltejs/kit';
export const load: PageServerLoad = async (event) => {
	const response = await api('/ingestion-sources', event);
	const responseText = await response.json();
	if (!response.ok) {
		throw error(response.status, responseText.message || 'Failed to fetch ingestions.');
	}
	const ingestionSources: IngestionSource[] = responseText;
	return {
		ingestionSources,
	};
};
