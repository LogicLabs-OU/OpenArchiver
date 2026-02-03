import { defineConfig } from 'vitepress';

export default defineConfig({
	head: [
		[
			'script',
			{
				defer: '',
				src: 'https://analytics.zenceipt.com/script.js',
				'data-website-id': '2c8b452e-eab5-4f82-8ead-902d8f8b976f',
			},
		],
		['link', { rel: 'icon', href: '/logo-sq.svg' }],
	],
	title: 'Open Archiver Docs',
	description: 'Official documentation for the Open Archiver project.',
	themeConfig: {
		search: {
			provider: 'local',
		},
		logo: {
			src: '/logo-sq.svg',
		},
		nav: [
			{ text: 'Home', link: '/' },
			{ text: 'Github', link: 'https://github.com/LogicLabs-OU/OpenArchiver' },
			{ text: 'Website', link: 'https://openarchiver.com/' },
			{ text: 'Discord', link: 'https://discord.gg/MTtD7BhuTQ' },
		],
		sidebar: [
			{
				text: 'User Guides',
				items: [
					{ text: 'Get Started', link: '/' },
					{ text: 'Installation', link: '/user-guides/installation' },
					{ text: 'Email Integrity Check', link: '/user-guides/integrity-check' },
					{
						text: 'Email Providers',
						link: '/user-guides/email-providers/',
						collapsed: true,
						items: [
							{
								text: 'Generic IMAP Server',
								link: '/user-guides/email-providers/imap',
							},
							{
								text: 'Google Workspace',
								link: '/user-guides/email-providers/google-workspace',
							},
							{
								text: 'Microsoft 365',
								link: '/user-guides/email-providers/microsoft-365',
							},
							{ text: 'EML Import', link: '/user-guides/email-providers/eml' },
							{ text: 'PST Import', link: '/user-guides/email-providers/pst' },
							{ text: 'Mbox Import', link: '/user-guides/email-providers/mbox' },
						],
					},
					{
						text: 'Settings',
						collapsed: true,
						items: [
							{
								text: 'System',
								link: '/user-guides/settings/system',
							},
						],
					},
					{
						text: 'Upgrading and Migration',
						collapsed: true,
						items: [
							{
								text: 'Upgrading',
								link: '/user-guides/upgrade-and-migration/upgrade',
							},
							{
								text: 'Meilisearch Upgrade',
								link: '/user-guides/upgrade-and-migration/meilisearch-upgrade',
							},
						],
					},
				],
			},
			{
				text: 'API Reference',
				items: [
					{ text: 'Overview', link: '/api/' },
					{ text: 'Authentication', link: '/api/authentication' },
					{ text: 'Rate Limiting', link: '/api/rate-limiting' },
					{ text: 'Auth', link: '/api/auth' },
					{ text: 'Archived Email', link: '/api/archived-email' },
					{ text: 'Dashboard', link: '/api/dashboard' },
					{ text: 'Ingestion', link: '/api/ingestion' },
					{ text: 'Integrity Check', link: '/api/integrity' },
					{ text: 'Search', link: '/api/search' },
					{ text: 'Storage', link: '/api/storage' },
					{ text: 'Jobs', link: '/api/jobs' },
				],
			},
			{
				text: 'Services',
				items: [
					{ text: 'Overview', link: '/services/' },
					{ text: 'Storage Service', link: '/services/storage-service' },
					{ text: 'OCR Service', link: '/services/ocr-service' },
					{
						text: 'IAM Service',
						items: [{ text: 'IAM Policies', link: '/services/iam-service/iam-policy' }],
					},
				],
			},
		],
	},
});
