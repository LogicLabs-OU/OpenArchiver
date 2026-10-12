import { api } from '$lib/server/api';
import { error, isHttpError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { SeatMailboxRow, SeatReportResponse } from './types';

const PAGE_SIZE = 25;

/**
 * Deliberately not gated behind `enterpriseMode`.
 *
 * Seats are what an Enterprise licence is priced on, so "how many would we need?" has to be
 * answerable before anyone buys one. Every input to the answer — the archived mailboxes, what the
 * directory said about them, the domain groups — is already held by the open-source edition, so
 * the count is exact rather than a teaser. Only reporting the number to the licence service, and
 * anything enforced on the back of it, belongs to Enterprise; the page says so when the edition is
 * open source.
 */
export const load: PageServerLoad = async (event) => {
	try {
		// The report is asked for first, and with `reconcileStale`, so a stale or missing count is
		// recomputed before the mailbox list is read: otherwise a mailbox the directory listed
		// shows zero emails until someone presses Recount.
		const reportRes = await api('/seats/report?reconcileStale=true', event);
		if (!reportRes.ok) {
			// The server's own status and message are passed through, so a permission refusal is
			// not flattened into a 500.
			const body = await reportRes.json().catch(() => ({}) as { message?: string });
			throw error(reportRes.status, body.message || 'Failed to load the seat report');
		}
		const report: SeatReportResponse = await reportRes.json();

		// Paging, search and the kind filter live in the page URL, so a filtered view can be
		// reloaded or shared, and the list is never limited to what one page happened to load.
		const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
		for (const key of ['page', 'search', 'kind']) {
			const value = event.url.searchParams.get(key)?.trim();
			if (value) {
				params.set(key, value);
			}
		}
		const mailboxesRes = await api(`/seats/mailboxes?${params.toString()}`, event);
		if (!mailboxesRes.ok) {
			const body = await mailboxesRes.json().catch(() => ({}) as { message?: string });
			throw error(mailboxesRes.status, body.message || 'Failed to load mailboxes');
		}
		const mailboxes: {
			mailboxes: SeatMailboxRow[];
			total: number;
			page: number;
			pageSize: number;
		} = await mailboxesRes.json();

		return { ...report, mailboxes, enterpriseMode: event.locals.enterpriseMode };
	} catch (e) {
		// HttpError does not extend Error, so `instanceof Error` would not match it and every
		// refusal above would be rewritten as a 500.
		if (isHttpError(e)) throw e;
		throw error(500, 'An unexpected error occurred while loading seat accounting.');
	}
};
