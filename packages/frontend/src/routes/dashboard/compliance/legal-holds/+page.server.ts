import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { LegalHold, SearchQuery } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		throw error(
			403,
			'This feature is only available in the Enterprise Edition. Please contact Open Archiver to upgrade.'
		);
	}

	const holdsRes = await api('/enterprise/legal-holds/holds', event);
	const holdsJson = await holdsRes.json();

	if (!holdsRes.ok) {
		throw error(holdsRes.status, holdsJson.message || JSON.stringify(holdsJson));
	}

	const holds: LegalHold[] = holdsJson;

	return { holds };
};

export const actions: Actions = {
	create: async (event) => {
		const data = await event.request.formData();

		const body = {
			name: data.get('name') as string,
			reason: (data.get('reason') as string) || undefined,
		};

		const response = await api('/enterprise/legal-holds/holds', event, {
			method: 'POST',
			body: JSON.stringify(body),
		});

		const res = await response.json();

		if (!response.ok) {
			return { success: false, message: res.message || 'Failed to create legal hold.' };
		}

		return { success: true };
	},

	update: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const body: Record<string, string | undefined> = {
			name: data.get('name') as string,
			reason: (data.get('reason') as string) || undefined,
		};

		const response = await api(`/enterprise/legal-holds/holds/${id}`, event, {
			method: 'PUT',
			body: JSON.stringify(body),
		});

		const res = await response.json();

		if (!response.ok) {
			return { success: false, message: res.message || 'Failed to update legal hold.' };
		}

		return { success: true };
	},

	toggleActive: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;
		const isActive = data.get('isActive') === 'true';

		const response = await api(`/enterprise/legal-holds/holds/${id}`, event, {
			method: 'PUT',
			body: JSON.stringify({ isActive }),
		});

		const res = await response.json();

		if (!response.ok) {
			return { success: false, message: res.message || 'Failed to update legal hold.' };
		}

		return { success: true, isActive };
	},

	delete: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const response = await api(`/enterprise/legal-holds/holds/${id}`, event, {
			method: 'DELETE',
		});

		if (!response.ok) {
			const res = await response.json().catch(() => ({}));
			return {
				success: false,
				message: (res as { message?: string }).message || 'Failed to delete legal hold.',
			};
		}

		return { success: true };
	},

	bulkApply: async (event) => {
		const data = await event.request.formData();
		const holdId = data.get('holdId') as string;
		const rawQuery = data.get('searchQuery') as string;

		let searchQuery: SearchQuery;
		try {
			searchQuery = JSON.parse(rawQuery) as SearchQuery;
		} catch {
			return { success: false, message: 'Invalid search query format.' };
		}

		const response = await api(`/enterprise/legal-holds/holds/${holdId}/bulk-apply`, event, {
			method: 'POST',
			body: JSON.stringify({ searchQuery }),
		});

		const res = await response.json();

		if (!response.ok) {
			return {
				success: false,
				message: (res as { message?: string }).message || 'Bulk apply failed.',
			};
		}

		const result = res as { emailsLinked: number };
		return { success: true, emailsLinked: result.emailsLinked };
	},

	releaseAll: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const response = await api(`/enterprise/legal-holds/holds/${id}/release-all`, event, {
			method: 'POST',
		});

		const res = await response.json();

		if (!response.ok) {
			return {
				success: false,
				message:
					(res as { message?: string }).message || 'Failed to release emails from hold.',
			};
		}

		const result = res as { emailsReleased: number };
		return { success: true, emailsReleased: result.emailsReleased };
	},
};
