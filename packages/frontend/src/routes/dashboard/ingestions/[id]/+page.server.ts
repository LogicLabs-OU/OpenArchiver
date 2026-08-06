import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { IngestionStats, SafeIngestionSource } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	const { id } = event.params;

	const [statsResponse, sourceResponse] = await Promise.all([
		api(`/ingestion-sources/${id}/stats`, event),
		api(`/ingestion-sources/${id}`, event),
	]);

	if (!statsResponse.ok) {
		const responseText = await statsResponse.json().catch(() => ({}));
		return error(
			statsResponse.status,
			responseText.message || 'Failed to load ingestion statistics.'
		);
	}

	const stats: IngestionStats = await statsResponse.json();
	const source: SafeIngestionSource | null = sourceResponse.ok
		? await sourceResponse.json()
		: null;

	return { stats, source };
};
