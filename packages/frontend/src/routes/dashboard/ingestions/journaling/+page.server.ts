import { api } from '$lib/server/api';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { JournalingSource } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		throw error(
			403,
			'This feature is only available in the Enterprise Edition. Please contact Open Archiver to upgrade.'
		);
	}

	const sourcesRes = await api('/enterprise/journaling', event);
	const sourcesJson = await sourcesRes.json();

	if (!sourcesRes.ok) {
		throw error(sourcesRes.status, sourcesJson.message || JSON.stringify(sourcesJson));
	}

	const sources: JournalingSource[] = sourcesJson;

	// Fetch SMTP listener health status
	const healthRes = await api('/enterprise/journaling/health', event);
	const healthJson = (await healthRes.json()) as { smtp: string; port: string };

	return {
		sources,
		smtpHealth: healthRes.ok ? healthJson : { smtp: 'down', port: '2525' },
	};
};

export const actions: Actions = {
	create: async (event) => {
		const data = await event.request.formData();

		const rawIps = (data.get('allowedIps') as string) || '';
		const allowedIps = rawIps
			.split(',')
			.map((ip) => ip.trim())
			.filter(Boolean);

		const body: Record<string, unknown> = {
			name: data.get('name') as string,
			allowedIps,
			requireTls: data.get('requireTls') === 'on',
		};

		const smtpUsername = data.get('smtpUsername') as string;
		const smtpPassword = data.get('smtpPassword') as string;
		if (smtpUsername) body.smtpUsername = smtpUsername;
		if (smtpPassword) body.smtpPassword = smtpPassword;

		const response = await api('/enterprise/journaling', event, {
			method: 'POST',
			body: JSON.stringify(body),
		});

		const res = await response.json();

		if (!response.ok) {
			return fail(response.status, {
				success: false,
				message: res.message || 'Failed to create journaling source.',
			});
		}

		return { success: true };
	},

	update: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const rawIps = (data.get('allowedIps') as string) || '';
		const allowedIps = rawIps
			.split(',')
			.map((ip) => ip.trim())
			.filter(Boolean);

		const body: Record<string, unknown> = {
			name: data.get('name') as string,
			allowedIps,
			requireTls: data.get('requireTls') === 'on',
		};

		const smtpUsername = data.get('smtpUsername') as string;
		const smtpPassword = data.get('smtpPassword') as string;
		if (smtpUsername) body.smtpUsername = smtpUsername;
		if (smtpPassword) body.smtpPassword = smtpPassword;

		const response = await api(`/enterprise/journaling/${id}`, event, {
			method: 'PUT',
			body: JSON.stringify(body),
		});

		const res = await response.json();

		if (!response.ok) {
			return fail(response.status, {
				success: false,
				message: res.message || 'Failed to update journaling source.',
			});
		}

		return { success: true };
	},

	toggleStatus: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;
		const status = data.get('status') as string;

		const response = await api(`/enterprise/journaling/${id}`, event, {
			method: 'PUT',
			body: JSON.stringify({ status }),
		});

		const res = await response.json();

		if (!response.ok) {
			return fail(response.status, {
				success: false,
				message: res.message || 'Failed to update status.',
			});
		}

		return { success: true, status };
	},

	regenerateAddress: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const response = await api(`/enterprise/journaling/${id}/regenerate-address`, event, {
			method: 'POST',
		});

		if (!response.ok) {
			const res = await response.json().catch(() => ({}));
			return fail(response.status, {
				success: false,
				message:
					(res as { message?: string }).message ||
					'Failed to regenerate routing address.',
			});
		}

		return { success: true };
	},

	delete: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const response = await api(`/enterprise/journaling/${id}`, event, {
			method: 'DELETE',
		});

		if (!response.ok) {
			const res = await response.json().catch(() => ({}));
			return fail(response.status, {
				success: false,
				message:
					(res as { message?: string }).message || 'Failed to delete journaling source.',
			});
		}

		return { success: true };
	},
};
