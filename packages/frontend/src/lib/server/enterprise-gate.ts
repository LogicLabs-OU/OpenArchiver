import { error } from '@sveltejs/kit';

/**
 * Refuses a page that belongs to the Enterprise Edition.
 *
 * The navigation is the same in both editions, so an open-source user reaches these pages the same
 * way they reach any other. What they get is the upgrade notice rather than a red failure alert —
 * `dashboard/+error.svelte` decides that from `code`, never from the 403 itself, so a genuine
 * permission refusal still looks like the error it is.
 *
 * Translation keys are passed rather than text: this runs on the server, where `$t` is not
 * available, and the component resolves them in the user's locale.
 *
 * The enterprise build never reaches this — `enterpriseMode` is true there — so it has its own work
 * to do before a lapsed licence looks the same. See enterprise-gate.md.
 *
 * @param featureKey Translation key for the feature name, shown as the heading.
 * @param pitchKey Translation key for the line describing what the feature does.
 */
export const enterpriseOnly = (featureKey: string, pitchKey: string): never => {
	throw error(403, {
		// Read by anything that only sees the status and message — logs, the API proxy, a client
		// that never renders our error page.
		message: 'This feature is only available in the Enterprise Edition.',
		code: 'enterprise_only',
		featureKey,
		pitchKey,
	});
};
