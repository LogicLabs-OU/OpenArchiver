import { api } from '$lib/server/api';
import type { User, Role } from '@open-archiver/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
    const [usersResponse, rolesResponse] = await Promise.all([
        api('/users', event),
        api('/iam/roles', event)
    ]);

    if (!usersResponse.ok) {
        const { message } = await usersResponse.json();
        throw error(usersResponse.status, message || 'Failed to fetch users');
    }
    if (!rolesResponse.ok) {
        const { message } = await rolesResponse.json();
        throw error(rolesResponse.status, message || 'Failed to fetch roles');
    }

    const users: User[] = await usersResponse.json();
    const roles: Role[] = await rolesResponse.json();
    return {
        users,
        roles
    };
};
