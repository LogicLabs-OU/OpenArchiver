import { api } from '$lib/server/api';
import type { PageServerLoad } from './$types';
import type { ConsolidatedLicenseStatus } from '@open-archiver/types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.enterpriseMode) {
		throw error(
			403,
			'This feature is only available in the Enterprise Edition. Please contact Open Archiver to upgrade.'
		);
	}
	try {
		const response = await api('/enterprise/status/license-status', event);
		const responseText = await response.json();
		if (!response.ok) {
			if (response.status === 404) {
				throw error(404, responseText.error || JSON.stringify(responseText));
			}
			// Handle other potential server errors
			throw error(response.status, 'Failed to fetch license status');
		}

		const licenseStatus: ConsolidatedLicenseStatus = responseText;

		return {
			licenseStatus,
		};
	} catch (e) {
		// Catch fetch errors or re-throw kit errors
		if (e instanceof Error) {
			throw error(
				500,
				'An unexpected error occurred while trying to fetch the license status.'
			);
		}
		throw e;
	}
};

export const actions = {
	revalidate: async (event) => {
		if (!event.locals.enterpriseMode) {
			throw error(403, 'Forbidden');
		}

		try {
			const response = await api('/enterprise/status/revalidate', event, {
				method: 'POST',
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				return {
					success: false,
					message: errorData.error || 'Failed to revalidate license',
				};
			}

			return {
				success: true,
			};
		} catch (e) {
			console.error('License revalidation failed:', e);
			return {
				success: false,
				message: 'An unexpected error occurred',
			};
		}
	},
};
