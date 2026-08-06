import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { api } from '$lib/server/api';
import type { MfaStatus } from '@open-archiver/types';

export const load: LayoutServerLoad = async (event) => {
	const { locals } = event;
	if (!locals.user) {
		throw redirect(302, '/signin');
	}

	// In enterprise mode, fetch the 2FA grace deadline so the global warning banner
	// can be shown on every dashboard page when enforcement is active.
	let mfaGraceDeadline: string | null = null;
	if (locals.enterpriseMode) {
		try {
			const res = await api('/enterprise/advanced-security/mfa/status', event);
			if (res.ok) {
				const status: MfaStatus = await res.json();
				// Only expose the grace deadline — the full status is fetched per-page
				// by the account page. Here we only need the deadline for the banner.
				if (!status.totpEnabled && status.graceDeadline) {
					mfaGraceDeadline = status.graceDeadline;
				}
			}
		} catch {
			// Non-critical — silently ignore if the endpoint is unavailable
		}
	}

	return {
		user: locals.user,
		mfaGraceDeadline,
	};
};
