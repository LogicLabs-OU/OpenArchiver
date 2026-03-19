import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type {
	RetentionPolicy,
	PolicyEvaluationResult,
	SafeIngestionSource,
} from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		throw error(
			403,
			'This feature is only available in the Enterprise Edition. Please contact Open Archiver to upgrade.'
		);
	}

	// Fetch policies and ingestion sources in parallel
	const [policiesRes, ingestionsRes] = await Promise.all([
		api('/enterprise/retention-policy/policies', event),
		api('/ingestion-sources', event),
	]);

	const policiesJson = await policiesRes.json();
	if (!policiesRes.ok) {
		throw error(policiesRes.status, policiesJson.message || JSON.stringify(policiesJson));
	}

	// Ingestion sources are best-effort — don't hard-fail if unavailable
	let ingestionSources: SafeIngestionSource[] = [];
	if (ingestionsRes.ok) {
		const ingestionsJson = await ingestionsRes.json();
		ingestionSources = Array.isArray(ingestionsJson) ? ingestionsJson : [];
	}

	const policies: RetentionPolicy[] = policiesJson;

	return { policies, ingestionSources };
};

export const actions: Actions = {
	create: async (event) => {
		const data = await event.request.formData();

		const conditionsRaw = JSON.parse(
			(data.get('conditions') as string) || '{"logicalOperator":"AND","rules":[]}'
		);

		// Parse ingestionScope: comma-separated UUIDs, or empty = null (all sources)
		const ingestionScopeRaw = (data.get('ingestionScope') as string) || '';
		const ingestionScope =
			ingestionScopeRaw.trim().length > 0
				? ingestionScopeRaw
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				: null;

		const body = {
			name: data.get('name') as string,
			description: (data.get('description') as string) || undefined,
			priority: Number(data.get('priority')),
			retentionPeriodDays: Number(data.get('retentionPeriodDays')),
			actionOnExpiry: 'delete_permanently' as const,
			isEnabled: data.get('isEnabled') === 'true',
			// Send null when no rules — means "apply to all emails"
			conditions: conditionsRaw.rules.length > 0 ? conditionsRaw : null,
			ingestionScope,
		};

		const response = await api('/enterprise/retention-policy/policies', event, {
			method: 'POST',
			body: JSON.stringify(body),
		});

		const res = await response.json();

		if (!response.ok) {
			return { success: false, message: res.message || 'Failed to create policy' };
		}

		return { success: true };
	},

	update: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const conditionsRaw = JSON.parse(
			(data.get('conditions') as string) || '{"logicalOperator":"AND","rules":[]}'
		);

		const ingestionScopeRaw = (data.get('ingestionScope') as string) || '';
		const ingestionScope =
			ingestionScopeRaw.trim().length > 0
				? ingestionScopeRaw
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				: null;

		const body = {
			name: data.get('name') as string,
			description: (data.get('description') as string) || undefined,
			priority: Number(data.get('priority')),
			retentionPeriodDays: Number(data.get('retentionPeriodDays')),
			actionOnExpiry: 'delete_permanently' as const,
			isEnabled: data.get('isEnabled') === 'true',
			conditions: conditionsRaw.rules.length > 0 ? conditionsRaw : null,
			ingestionScope,
		};

		const response = await api(`/enterprise/retention-policy/policies/${id}`, event, {
			method: 'PUT',
			body: JSON.stringify(body),
		});

		const res = await response.json();

		if (!response.ok) {
			return { success: false, message: res.message || 'Failed to update policy' };
		}

		return { success: true };
	},

	delete: async (event) => {
		const data = await event.request.formData();
		const id = data.get('id') as string;

		const response = await api(`/enterprise/retention-policy/policies/${id}`, event, {
			method: 'DELETE',
		});

		if (!response.ok) {
			const res = await response.json().catch(() => ({}));
			return { success: false, message: res.message || 'Failed to delete policy' };
		}

		return { success: true };
	},

	evaluate: async (event) => {
		const data = await event.request.formData();

		// Parse recipients and attachment types from comma-separated strings
		const recipientsRaw = (data.get('recipients') as string) || '';
		const attachmentTypesRaw = (data.get('attachmentTypes') as string) || '';
		const ingestionSourceId = (data.get('ingestionSourceId') as string) || undefined;

		const body = {
			emailMetadata: {
				sender: (data.get('sender') as string) || '',
				recipients: recipientsRaw
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean),
				subject: (data.get('subject') as string) || '',
				attachmentTypes: attachmentTypesRaw
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean),
				// Only include ingestionSourceId if a non-empty value was provided
				...(ingestionSourceId ? { ingestionSourceId } : {}),
			},
		};

		const response = await api('/enterprise/retention-policy/policies/evaluate', event, {
			method: 'POST',
			body: JSON.stringify(body),
		});

		const res = await response.json();

		if (!response.ok) {
			return {
				success: false,
				message: res.message || 'Failed to evaluate policies',
				evaluationResult: null as PolicyEvaluationResult | null,
			};
		}

		return {
			success: true,
			evaluationResult: res as PolicyEvaluationResult,
		};
	},
};
