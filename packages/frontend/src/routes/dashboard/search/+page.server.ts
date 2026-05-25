import type { PageServerLoad } from './$types';
import { api } from '$lib/server/api';
import type { SearchResult, SafeIngestionSource } from '@open-archiver/types';
import { decodeSearchParams, toApiSearchQuery, hasAnyFilter } from './url-state';

export const load: PageServerLoad = async (event) => {
	const draft = decodeSearchParams(event.url.searchParams);
	const apiQuery = toApiSearchQuery(draft);
	const shouldSearch = Boolean(apiQuery.query) || hasAnyFilter(draft);

	const [searchRes, sourcesRes] = await Promise.all([
		shouldSearch
			? api('/search', event, {
					method: 'POST',
					body: JSON.stringify(apiQuery),
					headers: { 'Content-Type': 'application/json' },
				})
			: Promise.resolve(null),
		api('/ingestion-sources', event),
	]);

	let searchResult: SearchResult | null = null;
	let error: string | undefined;

	if (searchRes) {
		try {
			if (searchRes.ok) {
				searchResult = (await searchRes.json()) as SearchResult;
			} else {
				const body = await searchRes.json().catch(() => ({}) as { message?: string });
				error = body.message || `Search failed (${searchRes.status})`;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error';
		}
	}

	let ingestionSources: SafeIngestionSource[] = [];
	if (sourcesRes.ok) {
		try {
			ingestionSources = (await sourcesRes.json()) as SafeIngestionSource[];
		} catch {
			// Non-fatal: the panel just hides the SourceFilter when the list is empty.
			ingestionSources = [];
		}
	}

	return {
		searchResult,
		draft,
		apiQuery,
		ingestionSources,
		error,
	};
};
