import { api } from '$lib/server/api';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { ArchivedEmail, IntegrityCheckResult } from '@open-archiver/types';

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

		return {
			email,
			integrityReport,
		};
	} catch (e) {
		console.error('Failed to load archived email:', e);
		return {
			email: null,
			integrityReport: [],
			error: 'Failed to load email',
		};
	}
};
