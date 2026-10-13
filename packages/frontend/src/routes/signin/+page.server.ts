import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { api } from '$lib/server/api';
import type { PublicSsoConfig } from '@open-archiver/types';

export const load = (async (event) => {
	const { locals } = event;
	if (locals.user) {
		throw redirect(307, '/dashboard');
	}

	// Which SSO buttons to draw, if any. The endpoint belongs to the enterprise
	// build and is licence-checked, so an open-source deployment gets a 404 and an
	// unlicensed one a 403 — both read the same way here: no SSO.
	let publicSso: PublicSsoConfig | null = null;
	try {
		const res = await api('/enterprise/sso/public', event);
		if (res.ok) {
			publicSso = await res.json();
		}
	} catch {
		// Non-critical: the password form stands on its own.
	}

	return { publicSso };
}) satisfies PageServerLoad;
