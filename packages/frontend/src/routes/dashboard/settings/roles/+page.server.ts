import { api } from '$lib/server/api';
import type { Role } from '@open-archiver/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const rolesResponse = await api('/iam/roles', event);

	if (!rolesResponse.ok) {
		const { message } = await rolesResponse.json();
		throw error(rolesResponse.status, message || 'Failed to fetch roles');
	}

	const roles: Role[] = await rolesResponse.json();
	return {
		roles,
	};
};
