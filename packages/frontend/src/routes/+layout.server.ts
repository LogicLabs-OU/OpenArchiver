import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import 'dotenv/config';
import { api } from '$lib/server/api';
import type { SystemSettings } from '@open-archiver/types';

export const load: LayoutServerLoad = async (event) => {
	const { locals, url } = event;
	const response = await api('/auth/status', event);

	if (response.ok) {
		const { needsSetup } = await response.json();

		if (needsSetup && url.pathname !== '/setup') {
			throw redirect(307, '/setup');
		}

		if (!needsSetup && url.pathname === '/setup') {
			throw redirect(307, '/signin');
		}
	} else {
		// if auth status check fails, we can't know if the setup is complete,
		// so we redirect to signin page as a safe fallback.
		if (url.pathname !== '/signin') {
			console.error('Failed to get auth status:', await response.text());
			throw redirect(307, '/signin');
		}
	}

	const systemSettingsResponse = await api('/settings/system', event);
	const systemSettings: SystemSettings | null = systemSettingsResponse.ok
		? await systemSettingsResponse.json()
		: null;

	return {
		user: locals.user,
		accessToken: locals.accessToken,
		isDemo: process.env.IS_DEMO === 'true',
		systemSettings,
	};
};
