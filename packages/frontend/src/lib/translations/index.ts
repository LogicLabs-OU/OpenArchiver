import i18n from 'sveltekit-i18n';
import type { Config } from 'sveltekit-i18n';

// Import your locales
import en from './en.json';
import de from './de.json';
import es from './es.json';
import fr from './fr.json';
import it from './it.json';
import pt from './pt.json';
import nl from './nl.json';
import ja from './ja.json';
import et from './et.json';
import el from './el.json';
import bg from './bg.json'
// This is your config object.
// It defines the languages and how to load them.
const config: Config = {
	// Define the loaders for each language
	loaders: [
		// English 🇬🇧
		{
			locale: 'en',
			key: 'app', // This key matches the top-level key in your en.json
			loader: async () => en.app, // We return the nested 'app' object
		},
		// German 🇩🇪
		{
			locale: 'de',
			key: 'app', // This key matches the top-level key in your en.json
			loader: async () => de.app, // We return the nested 'app' object
		},
		// Spanish 🇪🇸
		{
			locale: 'es',
			key: 'app',
			loader: async () => es.app,
		},
		// French 🇫🇷
		{
			locale: 'fr',
			key: 'app',
			loader: async () => fr.app,
		},
		// Italian 🇮🇹
		{
			locale: 'it',
			key: 'app',
			loader: async () => it.app,
		},
		// Portuguese 🇵🇹
		{
			locale: 'pt',
			key: 'app',
			loader: async () => pt.app,
		},
		// Dutch 🇳🇱
		{
			locale: 'nl',
			key: 'app',
			loader: async () => nl.app,
		},
		// Japanese 🇯🇵
		{
			locale: 'ja',
			key: 'app',
			loader: async () => ja.app,
		},
		// Estonian 🇪🇪
		{
			locale: 'et',
			key: 'app',
			loader: async () => et.app,
		},
		// Greek 🇬🇷
		{
			locale: 'el',
			key: 'app',
			loader: async () => el.app,
		},
		// Bulgarian 🇧🇬
		{
			locale: 'bg',
			key: 'app',
			loader: async () => bg.app,
		},
	],
	fallbackLocale: 'en',
};

// Create the i18n instance.
// export const i18nInstance = new i18n(config);

export const { t, locale, locales, loading, loadTranslations } = new i18n(config);

// Export the t store for use in components
// export const t = i18n.t;

// import i18n from 'sveltekit-i18n';
// import type { Config } from 'sveltekit-i18n';

// const config: Config = ({
//     loaders: [
//         {
//             locale: 'en',
//             key: 'app',
//             loader: async () => (
//                 await import('./en/app.json')
//             ).default,
//         },
//         {
//             locale: 'en',
//             key: 'marketing',
//             loader: async () => (
//                 await import('./en/marketing.json')
//             ).default,
//         },
//         {
//             locale: 'fr',
//             key: 'app',
//             loader: async () => (
//                 await import('./fr/app.json')
//             ).default,
//         },
//         {
//             locale: 'fr',
//             key: 'marketing',
//             loader: async () => (
//                 await import('./fr/marketing.json')
//             ).default,
//         },
//     ],
//     fallbackLocale: 'en'
// });

// export const { t, locale, locales, loading, loadTranslations } = new i18n(config);
