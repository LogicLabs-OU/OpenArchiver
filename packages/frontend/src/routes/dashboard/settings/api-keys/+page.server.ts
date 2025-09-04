import { api } from '$lib/server/api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
    const response = await api('/api-keys', event);
    const apiKeys = await response.json();

    return {
        apiKeys,
    };
};

export const actions: Actions = {
    generate: async (event) => {
        const data = await event.request.formData();
        const name = data.get('name') as string;
        const expiresInDays = Number(data.get('expiresInDays'));

        const response = await api('/api-keys', event, {
            method: 'POST',
            body: JSON.stringify({ name, expiresInDays }),
        });

        const responseBody = await response.json();

        if (!response.ok) {
            return {
                message: responseBody.message || '',
                errors: responseBody.errors
            }
        }


        return {
            newApiKey: responseBody.key,
        };
    },
    delete: async (event) => {
        const data = await event.request.formData();
        const id = data.get('id') as string;

        await api(`/api-keys/${id}`, event, {
            method: 'DELETE',
        });

        return {
            success: true,
        };
    },
};
