import DefaultTheme from 'vitepress/theme';
import type { EnhanceAppContext } from 'vitepress';
import { theme, useOpenapi } from 'vitepress-openapi/client';
import 'vitepress-openapi/dist/style.css';
import spec from '../../api/openapi.json';

export default {
	...DefaultTheme,
	enhanceApp({ app, router, siteData }: EnhanceAppContext) {
		// Delegate to DefaultTheme first
		DefaultTheme.enhanceApp?.({ app, router, siteData });

		// Install vitepress-openapi theme: registers i18n plugin + all OA components
		theme.enhanceApp({ app, router, siteData });

		// Initialize the global OpenAPI spec
		useOpenapi({ spec });
	},
};
