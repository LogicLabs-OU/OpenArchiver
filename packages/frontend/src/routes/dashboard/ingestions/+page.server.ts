import { api } from '$lib/server/api';
import type { PageServerLoad } from './$types';
import type { IngestionSource } from '@open-archiver/types';
import { error } from '@sveltejs/kit';
export const load: PageServerLoad = async (event) => {
	const response = await api('/ingestion-sources', event);
	if (!response.ok) {
		let message = 'Failed to fetch ingestions.';
		try {
			const body = await response.json();
			message = body.message || message;
		} catch {
			// Response was not JSON (e.g. HTML error page from the backend)
		}
		throw error(response.status, message);
	}
	const ingestionSources: IngestionSource[] = await response.json();
	return {
		ingestionSources,
	};
};
