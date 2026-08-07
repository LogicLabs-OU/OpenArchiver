import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import 'dotenv/config';
import { api } from '$lib/server/api';
import { accessTokenCookieName } from '$lib/auth-cookie';
import type { SystemSettings } from '@open-archiver/types';
import { version } from '../../../../package.json';
import semver from 'semver';

let newVersionInfo: { version: string; description: string; url: string } | null = null;
let lastChecked: Date | null = null;

export const load: LayoutServerLoad = async (event) => {
	const { locals, url } = event;
	const response = await api('/auth/status', event);

	if (!response.ok) {
		// Without a status answer the setup state is unknown. Redirecting to /signin used to be
		// the fallback, but on a fresh instance that is a login form for an account that does not
		// exist yet — and the backend is commonly still booting while the frontend already serves
		// requests. Report the outage instead of guessing.
		console.error('Failed to get auth status:', await response.text());
		throw error(503, 'Cannot reach the Open Archiver API. Please try again in a moment.');
	}

	const { needsSetup }: { needsSetup: boolean } = await response.json();

	if (needsSetup) {
		// A database wipe leaves the previous install's access token in the browser, and it still
		// verifies while JWT_SECRET is unchanged. Drop it so the instance starts from a clean slate.
		const cookieName = accessTokenCookieName(url.port);
		if (event.cookies.get(cookieName)) {
			event.cookies.delete(cookieName, { path: '/' });
		}

		if (url.pathname !== '/setup') {
			throw redirect(307, '/setup');
		}
	}

	if (!needsSetup && url.pathname === '/setup') {
		throw redirect(307, '/signin');
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
		} catch (err) {
			console.error('Failed to fetch latest version from GitHub:', err);
		}
	}

	return {
		user: locals.user,
		accessToken: locals.accessToken,
		enterpriseMode: locals.enterpriseMode,
		needsSetup,
		systemSettings,
		currentVersion: version,
		newVersionInfo: newVersionInfo,
	};
};
