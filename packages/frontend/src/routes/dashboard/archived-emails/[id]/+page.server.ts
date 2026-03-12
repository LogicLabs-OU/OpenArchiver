import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type {
	ArchivedEmail,
	IntegrityCheckResult,
	PolicyEvaluationResult,
	RetentionLabel,
	EmailRetentionLabelInfo,
	LegalHold,
	EmailLegalHoldInfo,
} from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	try {
		const { id } = event.params;

		const [emailResponse, integrityResponse] = await Promise.all([
			api(`/archived-emails/${id}`, event),
			api(`/integrity/${id}`, event),
		]);

		if (!emailResponse.ok) {
			const responseText = await emailResponse.json();
			return error(
				emailResponse.status,
				responseText.message || 'You do not have permission to read this email.'
			);
		}

		if (!integrityResponse.ok) {
			const responseText = await integrityResponse.json();
			return error(
				integrityResponse.status,
				responseText.message || 'Failed to perform integrity check.'
			);
		}

		const email: ArchivedEmail = await emailResponse.json();
		const integrityReport: IntegrityCheckResult[] = await integrityResponse.json();

		// Enterprise-only: fetch retention policy evaluation separately
		// to keep the OSS code path completely untouched.
		let retentionPolicy: PolicyEvaluationResult | null = null;
		let retentionLabels: RetentionLabel[] = [];
		let emailRetentionLabel: EmailRetentionLabelInfo | null = null;
		let legalHolds: LegalHold[] = [];
		let emailLegalHolds: EmailLegalHoldInfo[] = [];

		if (event.locals.enterpriseMode) {
			// Fetch all enterprise compliance data in parallel — all best-effort
			const [retentionRes, labelsRes, emailLabelRes, holdsRes, emailHoldsRes] =
				await Promise.all([
					api(`/enterprise/retention-policy/email/${id}`, event).catch(() => null),
					api('/enterprise/retention-policy/labels', event).catch(() => null),
					api(`/enterprise/retention-policy/email/${id}/label`, event).catch(() => null),
					api('/enterprise/legal-holds/holds', event).catch(() => null),
					api(`/enterprise/legal-holds/email/${id}/holds`, event).catch(() => null),
				]);

			if (retentionRes?.ok) {
				retentionPolicy = await retentionRes.json();
			}

			if (labelsRes?.ok) {
				const labelsJson: RetentionLabel[] = await labelsRes.json();
				// Only show enabled labels in the dropdown
				retentionLabels = labelsJson.filter((l) => !l.isDisabled);
			}

			if (emailLabelRes?.ok) {
				emailRetentionLabel = await emailLabelRes.json();
			}

			if (holdsRes?.ok) {
				const holdsJson: LegalHold[] = await holdsRes.json();
				// Only show active holds in the apply dropdown
				legalHolds = holdsJson.filter((h) => h.isActive);
			}

			if (emailHoldsRes?.ok) {
				emailLegalHolds = await emailHoldsRes.json();
			}
		}

		return {
			email,
			integrityReport,
			retentionPolicy,
			retentionLabels,
			emailRetentionLabel,
			legalHolds,
			emailLegalHolds,
		};
	} catch (e) {
		console.error('Failed to load archived email:', e);
		return {
			email: null,
			integrityReport: [],
			retentionPolicy: null,
			retentionLabels: [],
			emailRetentionLabel: null,
			legalHolds: [],
			emailLegalHolds: [],
			error: 'Failed to load email',
		};
	}
};

export const actions: Actions = {
	applyLabel: async (event) => {
		const data = await event.request.formData();
		const emailId = event.params.id;
		const labelId = data.get('labelId') as string;

		const response = await api(`/enterprise/retention-policy/email/${emailId}/label`, event, {
			method: 'POST',
			body: JSON.stringify({ labelId }),
		});

		if (!response.ok) {
			const res = await response.json().catch(() => ({}));
			return { success: false, message: (res as { message?: string }).message || 'Failed to apply label' };
		}

		return { success: true, action: 'applied' };
	},

	removeLabel: async (event) => {
		const emailId = event.params.id;

		const response = await api(`/enterprise/retention-policy/email/${emailId}/label`, event, {
			method: 'DELETE',
		});

		if (!response.ok) {
			const res = await response.json().catch(() => ({}));
			return { success: false, message: (res as { message?: string }).message || 'Failed to remove label' };
		}

		return { success: true, action: 'removed' };
	},

	applyHold: async (event) => {
		const data = await event.request.formData();
		const emailId = event.params.id;
		const holdId = data.get('holdId') as string;

		const response = await api(`/enterprise/legal-holds/email/${emailId}/holds`, event, {
			method: 'POST',
			body: JSON.stringify({ holdId }),
		});

		if (!response.ok) {
			const res = await response.json().catch(() => ({}));
			return {
				success: false,
				message: (res as { message?: string }).message || 'Failed to apply legal hold.',
			};
		}

		return { success: true, action: 'holdApplied' };
	},

	removeHold: async (event) => {
		const data = await event.request.formData();
		const emailId = event.params.id;
		const holdId = data.get('holdId') as string;

		const response = await api(
			`/enterprise/legal-holds/email/${emailId}/holds/${holdId}`,
			event,
			{ method: 'DELETE' }
		);

		if (!response.ok) {
			const res = await response.json().catch(() => ({}));
			return {
				success: false,
				message: (res as { message?: string }).message || 'Failed to remove legal hold.',
			};
		}

		return { success: true, action: 'holdRemoved' };
	},
};
