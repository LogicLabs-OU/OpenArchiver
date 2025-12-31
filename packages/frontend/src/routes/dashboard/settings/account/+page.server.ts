import type { PageServerLoad, Actions } from './$types';
import { api } from '$lib/server/api';
import { fail } from '@sveltejs/kit';
import type { User } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	const response = await api('/users/profile', event);
	if (!response.ok) {
		const error = await response.json();
		console.error('Failed to fetch profile:', error);
		// Return null user if failed, handle in UI
		return { user: null };
	}
	const user: User = await response.json();
	return { user };
};

export const actions: Actions = {
	updateProfile: async (event) => {
		const data = await event.request.formData();
		const first_name = data.get('first_name');
		const last_name = data.get('last_name');
		const email = data.get('email');

		const response = await api('/users/profile', event, {
			method: 'PATCH',
			body: JSON.stringify({ first_name, last_name, email }),
		});

		if (!response.ok) {
			const error = await response.json();
			return fail(response.status, {
				profileError: true,
				message: error.message || 'Failed to update profile',
			});
		}
		return { success: true };
	},
	updatePassword: async (event) => {
		const data = await event.request.formData();
		const currentPassword = data.get('currentPassword');
		const newPassword = data.get('newPassword');

		const response = await api('/users/profile/password', event, {
			method: 'POST',
			body: JSON.stringify({ currentPassword, newPassword }),
		});

		if (!response.ok) {
			const error = await response.json();
			return fail(response.status, {
				passwordError: true,
				message: error.message || 'Failed to update password',
			});
		}
		return { success: true };
	},
};
