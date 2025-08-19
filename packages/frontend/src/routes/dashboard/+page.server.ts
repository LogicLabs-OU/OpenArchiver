import type { PageServerLoad } from './$types';
import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type {
	DashboardStats,
	IngestionHistory,
	IngestionSourceStats,
	RecentSync,
	IndexedInsights,
} from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	const fetchStats = async (): Promise<DashboardStats | null> => {
		const response = await api('/dashboard/stats', event);
		const responseText = await response.json();
		if (!response.ok) {
			throw error(response.status, responseText.message || 'Failed to fetch data');
		}
		return responseText;
	};

	const fetchIngestionHistory = async (): Promise<IngestionHistory | null> => {
		const response = await api('/dashboard/ingestion-history', event);
		const responseText = await response.json();
		if (!response.ok) {
			return error(
				response.status,
				responseText.message || 'Failed to fetch ingestion history'
			);
		}
		return responseText;
	};

	const fetchIngestionSources = async (): Promise<IngestionSourceStats[] | null> => {
		const response = await api('/dashboard/ingestion-sources', event);
		const responseText = await response.json();
		if (!response.ok) {
			return error(
				response.status,
				responseText.message || 'Failed to fetch ingestion sources'
			);
		}
		return responseText;
	};

	const fetchRecentSyncs = async (): Promise<RecentSync[] | null> => {
		const response = await api('/dashboard/recent-syncs', event);
		const responseText = await response.json();
		if (!response.ok) {
			return error(response.status, responseText.message || 'Failed to fetch recent syncs');
		}
		return responseText;
	};

	const fetchIndexedInsights = async (): Promise<IndexedInsights | null> => {
		const response = await api('/dashboard/indexed-insights', event);
		const responseText = await response.json();
		if (!response.ok) {
			return error(
				response.status,
				responseText.message || 'Failed to fetch indexed insights'
			);
		}
		return responseText;
	};

	const [stats, ingestionHistory, ingestionSources, recentSyncs, indexedInsights] =
		await Promise.all([
			fetchStats(),
			fetchIngestionHistory(),
			fetchIngestionSources(),
			fetchRecentSyncs(),
			fetchIndexedInsights(),
		]);

	return {
		stats,
		ingestionHistory,
		ingestionSources,
		recentSyncs,
		indexedInsights,
	};
};
