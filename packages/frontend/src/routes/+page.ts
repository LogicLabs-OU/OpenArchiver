import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	const { user, needsSetup } = await parent();

	// An instance without any account always goes to /setup, even when the browser still carries a
	// token from a previous install that decodes fine but points at a user who no longer exists.
	if (needsSetup) {
		throw redirect(307, '/setup');
	}

	if (user) {
		throw redirect(307, '/dashboard');
	} else {
		throw redirect(307, '/signin');
	}
};
