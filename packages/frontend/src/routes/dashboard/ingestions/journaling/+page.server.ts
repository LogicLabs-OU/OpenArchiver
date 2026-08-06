import { api } from '$lib/server/api';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type {
	JournalingSource,
	SafeIngestionSource,
	OrganizationDomainGroup,
} from '@open-archiver/types';

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

	// Fetch existing ingestion sources for the merge-into dropdown
	const ingestionRes = await api('/ingestion-sources', event);
	const ingestionJson = await ingestionRes.json();

	if (!ingestionRes.ok) {
		throw error(
			ingestionRes.status,
			ingestionJson.message || 'Failed to load ingestion sources.'
		);
	}

	const ingestionSources: SafeIngestionSource[] = ingestionJson;

	return {
		sources,
		smtpHealth: healthRes.ok ? healthJson : { smtp: 'down', port: '2525' },
		ingestionSources,
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

		// organizationDomains is submitted as a JSON string of OrganizationDomainGroup[]
		let organizationDomains: OrganizationDomainGroup[] = [];
		const rawDomains = data.get('organizationDomains') as string;
		if (rawDomains) {
			try {
				organizationDomains = JSON.parse(rawDomains) as OrganizationDomainGroup[];
			} catch {
				// malformed JSON — treat as empty
			}
		}

		const body: Record<string, unknown> = {
			name: data.get('name') as string,
			allowedIps,
			organizationDomains,
			requireTls: data.get('requireTls') === 'on',
			preserveOriginalFile: data.get('preserveOriginalFile') !== 'off',
		};

		const smtpUsername = data.get('smtpUsername') as string;
		const smtpPassword = data.get('smtpPassword') as string;
		if (smtpUsername) body.smtpUsername = smtpUsername;
		if (smtpPassword) body.smtpPassword = smtpPassword;

		const mergedIntoId = data.get('mergedIntoId') as string;
		if (mergedIntoId) body.mergedIntoId = mergedIntoId;

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

		// organizationDomains is submitted as a JSON string of OrganizationDomainGroup[]
		let organizationDomains: OrganizationDomainGroup[] = [];
		const rawDomains = data.get('organizationDomains') as string;
		if (rawDomains) {
			try {
				organizationDomains = JSON.parse(rawDomains) as OrganizationDomainGroup[];
			} catch {
				// malformed JSON — treat as empty
			}
		}

		const body: Record<string, unknown> = {
			name: data.get('name') as string,
			allowedIps,
			organizationDomains,
			requireTls: data.get('requireTls') === 'on',
		};

		// Always send smtpUsername — empty string signals "clear it" to the service.
		body.smtpUsername = (data.get('smtpUsername') as string) ?? '';

		// Only send smtpPassword when the user actually typed in the field.
		// The hidden input smtpPasswordChanged=true is set by the form when the user edits the field.
		// If false/absent, we omit the field so the service leaves the existing hash untouched.
		const smtpPasswordChanged = data.get('smtpPasswordChanged') === 'true';
		if (smtpPasswordChanged) {
			body.smtpPassword = (data.get('smtpPassword') as string) ?? '';
		}

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
