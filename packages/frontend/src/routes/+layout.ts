import { loadTranslations } from '$lib/translations';
import type { LayoutLoad } from './$types';
import { browser } from '$app/environment';
import type { SupportedLanguage } from '@open-archiver/types';

export const load: LayoutLoad = async ({ url, data }) => {
	const { pathname } = url;

	let initLocale: SupportedLanguage = 'en'; // Default fallback

	if (data.settings?.language) {
		initLocale = data.settings.language;
	}

	console.log(initLocale);
	await loadTranslations(initLocale, pathname);

	return {
		...data,
	};
};
