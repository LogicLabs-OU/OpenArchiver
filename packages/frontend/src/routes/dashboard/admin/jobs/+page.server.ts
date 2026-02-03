import { api } from '$lib/server/api';
import { error, type NumericRange } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { IGetQueuesResponse } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	try {
		const response = await api('/jobs/queues', event);

		if (!response.ok) {
			const responseText = await response.json();
			throw error(
				response.status as NumericRange<400, 599>,
				responseText.message || 'Failed to fetch job queues.'
			);
		}

		const data: IGetQueuesResponse = await response.json();

		return {
			queues: data.queues,
		};
	} catch (e: any) {
		console.error('Failed to load job queues:', e);
		throw error(e.status || 500, e.body?.message || 'Failed to load job queues');
	}
};
