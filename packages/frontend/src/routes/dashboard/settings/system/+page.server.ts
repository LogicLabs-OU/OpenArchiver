import { api } from '$lib/server/api';
import type { SystemSettings } from '@open-archiver/types';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const response = await api('/settings', event);

	if (!response.ok) {
		const { message } = await response.json();
		throw error(response.status, message || 'Failed to fetch system settings');
	}

	const settings: SystemSettings = await response.json();
	return {
		settings,
	};
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const language = formData.get('language');
		const theme = formData.get('theme');
		const supportEmail = formData.get('supportEmail');

		const body: Partial<SystemSettings> = {
			language: language as SystemSettings['language'],
			theme: theme as SystemSettings['theme'],
			supportEmail: supportEmail ? String(supportEmail) : null,
		};

		const response = await api('/settings', event, {
			method: 'PUT',
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const { message } = await response.json();
			return fail(response.status, { message: message || 'Failed to update settings' });
		}

		const updatedSettings: SystemSettings = await response.json();

		return {
			success: true,
			settings: updatedSettings,
		};
	},
};
