import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import 'dotenv/config';
import { api } from '$lib/server/api';
import type { SystemSettings } from '@open-archiver/types';
import { version } from '../../../../package.json';
import semver from 'semver';

let newVersionInfo: { version: string; description: string; url: string } | null = null;
let lastChecked: Date | null = null;

export const load: LayoutServerLoad = async (event) => {
	const { locals, url } = event;
	const response = await api('/auth/status', event);

	if (response.ok) {
		const { needsSetup } = await response.json();

		if (needsSetup && url.pathname !== '/setup') {
			throw redirect(307, '/setup');
		}

		if (!needsSetup && url.pathname === '/setup') {
			throw redirect(307, '/signin');
		}
	} else {
		// if auth status check fails, we can't know if the setup is complete,
		// so we redirect to signin page as a safe fallback.
		if (url.pathname !== '/signin') {
			console.error('Failed to get auth status:', await response.text());
			throw redirect(307, '/signin');
		}
	}

	const systemSettingsResponse = await api('/settings/system', event);
	const systemSettings: SystemSettings | null = systemSettingsResponse.ok
		? await systemSettingsResponse.json()
		: null;

	const now = new Date();
	if (!lastChecked || now.getTime() - lastChecked.getTime() > 1000 * 60 * 60) {
		try {
			const res = await fetch(
				'https://api.github.com/repos/LogicLabs-OU/OpenArchiver/releases/latest'
			);
			if (res.ok) {
				const latestRelease = await res.json();
				const latestVersion = latestRelease.tag_name.replace('v', '');
				if (semver.gt(latestVersion, version)) {
					newVersionInfo = {
						version: latestVersion,
						description: latestRelease.name,
						url: latestRelease.html_url,
					};
				}
			}
			lastChecked = now;
		} catch (error) {
			console.error('Failed to fetch latest version from GitHub:', error);
		}
	}

	return {
		user: locals.user,
		accessToken: locals.accessToken,
		enterpriseMode: locals.enterpriseMode,
		systemSettings,
		currentVersion: version,
		newVersionInfo: newVersionInfo,
	};
};
