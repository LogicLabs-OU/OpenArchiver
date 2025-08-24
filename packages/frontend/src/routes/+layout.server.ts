import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import 'dotenv/config';
import { api } from '$lib/server/api';

export const load: LayoutServerLoad = async (event) => {
	const { locals, url } = event;
	try {
		const response = await api('/auth/status', event);
		const { needsSetup } = await response.json();

		if (needsSetup && url.pathname !== '/setup') {
			throw redirect(307, '/setup');
		}

		if (!needsSetup && url.pathname === '/setup') {
			throw redirect(307, '/signin');
		}
	} catch (error) {
		throw error;
	}

	const settingsResponse = await api('/settings', event);
	const settings = settingsResponse.ok ? await settingsResponse.json() : null;

	return {
		user: locals.user,
		accessToken: locals.accessToken,
		isDemo: process.env.IS_DEMO === 'true',
		settings,
	};
};
