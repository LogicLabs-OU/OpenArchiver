import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RetentionLabel } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		throw error(
			403,
			'This feature is only available in the Enterprise Edition. Please contact Open Archiver to upgrade.'
		);
	}

	const labelsRes = await api('/enterprise/retention-policy/labels', event);
	const labelsJson = await labelsRes.json();

	if (!labelsRes.ok) {
		throw error(labelsRes.status, labelsJson.message || JSON.stringify(labelsJson));
	}

	const labels: RetentionLabel[] = labelsJson;

	return { labels };
};

export const actions: Actions = {
	create: async (event) => {
		const data = await event.request.formData();

		const body = {
			name: data.get('name') as string,
			description: (data.get('description') as string) || undefined,
			retentionPeriodDays: Number(data.get('retentionPeriodDays')),
		};

		const response = await api('/enterprise/retention-policy/labels', event, {
			method: 'POST',
			body: JSON.stringify(body),
		});

		const res = await response.json();

		if (!response.ok) {
			return { success: false, message: res.message || 'Failed to create label' };
		}

		return { success: true };
	},

	update: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const body: Record<string, string | number | undefined> = {
			name: data.get('name') as string,
			description: (data.get('description') as string) || undefined,
		};

		// Only include retentionPeriodDays if provided (it may be locked)
		const retentionDays = data.get('retentionPeriodDays');
		if (retentionDays) {
			body.retentionPeriodDays = Number(retentionDays);
		}

		const response = await api(`/enterprise/retention-policy/labels/${id}`, event, {
			method: 'PUT',
			body: JSON.stringify(body),
		});

		const res = await response.json();

		if (!response.ok) {
			return { success: false, message: res.message || 'Failed to update label' };
		}

		return { success: true };
	},

	delete: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const response = await api(`/enterprise/retention-policy/labels/${id}`, event, {
			method: 'DELETE',
		});

		if (!response.ok) {
			const res = await response.json().catch(() => ({}));
			return { success: false, message: res.message || 'Failed to delete label' };
		}

		const result = await response.json();

		return { success: true, action: result.action as 'deleted' | 'disabled' };
	},
};
