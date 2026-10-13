import { api } from '$lib/server/api';
import type { PageServerLoad } from './$types';
import type { SafeIngestionSource } from '@open-archiver/types';
import { error } from '@sveltejs/kit';
export const load: PageServerLoad = async (event) => {
	const response = await api('/ingestion-sources', event);
	const responseText = await response.json();
	if (!response.ok) {
		throw error(response.status, responseText.message || 'Failed to fetch ingestions.');
	}
	const ingestionSources: SafeIngestionSource[] = responseText;
	// The OAuth redirect URI the BACKEND will actually send, which is built from APP_URL.
	// Derived here rather than from window.location so the value shown for registration
	// matches what the provider receives — reaching the instance on any other origin
	// (an IP, a second hostname, a tunnel) would otherwise print a URI that fails with a
	// redirect mismatch. Null when APP_URL is unset, and the form falls back to the
	// browser's origin.
	const appUrl = process.env.APP_URL?.replace(/\/+$/, '') || null;
	return {
		ingestionSources,
		oauthRedirectUri: appUrl ? `${appUrl}/api/v1/oauth/callback` : null,
	};
};
