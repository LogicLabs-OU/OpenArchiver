import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
    if (!locals.user) {
        throw redirect(302, '/signin');
    }
    return {
        user: locals.user
    };
};
