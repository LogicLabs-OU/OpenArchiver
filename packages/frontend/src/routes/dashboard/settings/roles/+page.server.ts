import { api } from '$lib/server/api';
import type { Role, SafeIngestionSource, User } from '@open-archiver/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Loads a list the policy editor uses to prepopulate a picker.
 *
 * These are conveniences, not requirements: an admin may lack the permission to read ingestion
 * sources or users, and the search index may be unavailable. Returning null lets the editor fall
 * back to entering raw identifiers instead of failing the whole page.
 */
const loadOptional = async <T>(path: string, event: Parameters<PageServerLoad>[0]) => {
	try {
		const response = await api(path, event);
		if (!response.ok) {
			console.warn(`Policy editor could not load ${path}: ${response.status}`);
			return null;
		}
		return (await response.json()) as T;
	} catch (error) {
		console.warn(`Policy editor could not load ${path}:`, error);
		return null;
	}
};

export const load: PageServerLoad = async (event) => {
	const [rolesResponse, sources, users] = await Promise.all([
		api('/iam/roles', event),
		loadOptional<SafeIngestionSource[]>('/ingestion-sources', event),
		loadOptional<User[]>('/users', event),
	]);

	if (!rolesResponse.ok) {
		const { message } = await rolesResponse.json();
		throw error(rolesResponse.status, message || 'Failed to fetch roles');
	}

	const roles: Role[] = await rolesResponse.json();

	return {
		roles,
		sources,
		// Only the id and address are needed to pick an owner in a policy condition.
		users: users ? users.map((user) => ({ id: user.id, email: user.email })) : null,
	};
};
