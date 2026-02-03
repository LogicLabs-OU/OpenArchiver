import { api } from '$lib/server/api';
import { error, type NumericRange } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { IGetQueueJobsResponse, JobStatus } from '@open-archiver/types';

export const load: PageServerLoad = async (event) => {
	const { queueName } = event.params;
	const status = (event.url.searchParams.get('status') || 'failed') as JobStatus;
	const page = event.url.searchParams.get('page') || '1';
	const limit = event.url.searchParams.get('limit') || '10';

	try {
		const response = await api(
			`/jobs/queues/${queueName}?status=${status}&page=${page}&limit=${limit}`,
			event
		);

		if (!response.ok) {
			const responseText = await response.json();
			throw error(
				response.status as NumericRange<400, 599>,
				responseText.message || 'Failed to fetch job queue details.'
			);
		}

		const data: IGetQueueJobsResponse = await response.json();

		return {
			queue: data,
		};
	} catch (e: any) {
		console.error('Failed to load job queue details:', e);
		throw error(e.status || 500, e.body?.message || 'Failed to load job queue details');
	}
};
