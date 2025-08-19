import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { ArchivedEmail } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	try {
		const { id } = event.params;
		const response = await api(`/archived-emails/${id}`, event);
		const responseText = await response.json()
		if (!response.ok) {
			return error(response.status, responseText.message || 'You do not have permission to read this email.')
		}
		const email: ArchivedEmail = responseText;
		return {
			email,
		};
	} catch (error) {
		console.error('Failed to load archived email:', error);
		return {
			email: null,
			error: 'Failed to load email',
		};
	}
};
