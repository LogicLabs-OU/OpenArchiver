import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { IngestionSource, PaginatedArchivedEmails } from '@open-archiver/types';

const ALL_SOURCES = 'all';

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
			ingestionSources = [];
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

	// Default to "all sources" when no explicit selection — gives users a cross-source
	// overview without needing to pick one inbox first.
	const selectedIngestionSourceId =
		ingestionSourceId ?? (ingestionSources.length > 0 ? ALL_SOURCES : undefined);

	if (selectedIngestionSourceId === ALL_SOURCES) {
		const emailsResponse = await api(
			`/archived-emails?page=${page}&limit=${limit}`,
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
	} else if (selectedIngestionSourceId) {
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
