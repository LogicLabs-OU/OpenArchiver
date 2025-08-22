import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { IngestionSource, PaginatedArchivedEmails } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const ingestionSourceId = url.searchParams.get('ingestionSourceId');
	const page = url.searchParams.get('page') || '1';
	const limit = url.searchParams.get('limit') || '10';

	const sourcesResponse = await api('/ingestion-sources', event);
	const sourcesResponseText = await sourcesResponse.json();
	let ingestionSources: IngestionSource[] = sourcesResponseText;
	if (!sourcesResponse.ok) {
		if (sourcesResponse.status === 403) {
			ingestionSources = []
		} else {
			return error(
				sourcesResponse.status,
				sourcesResponseText.message || 'Failed to load ingestion source.'
			);
		}
	}


	let archivedEmails: PaginatedArchivedEmails = {
		items: [],
		total: 0,
		page: 1,
		limit: 10,
	};

	// Use the provided ingestionSourceId, or default to the first one if it's not provided.
	const selectedIngestionSourceId = ingestionSourceId || ingestionSources[0]?.id;

	if (selectedIngestionSourceId) {
		const emailsResponse = await api(
			`/archived-emails/ingestion-source/${selectedIngestionSourceId}?page=${page}&limit=${limit}`,
			event
		);
		const responseText = await emailsResponse.json();
		if (!emailsResponse.ok) {
			return error(
				emailsResponse.status,
				responseText.message || 'Failed to load archived emails.'
			);
		}
		archivedEmails = responseText;
	}

	return {
		ingestionSources,
		archivedEmails,
		selectedIngestionSourceId,
	};
};
