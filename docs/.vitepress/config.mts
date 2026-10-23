import { defineConfig } from 'vitepress';
import { useSidebar } from 'vitepress-openapi';
import spec from '../api/openapi.json';

export default defineConfig({
	head: [
		[
			'script',
			{
				defer: '',
				src: 'https://analytics.openarchiver.com/script.js',
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
					{ text: 'Searching the Archive', link: '/user-guides/searching' },
					{ text: 'Search Indexing & Reindexing', link: '/user-guides/search-indexing' },
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
								text: 'JMAP',
								link: '/user-guides/email-providers/jmap',
							},
							{
								text: 'OAuth Mailbox (Outlook.com)',
								link: '/user-guides/email-providers/oauth-mailbox',
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
					{
						text: 'Troubleshooting',
						collapsed: true,
						items: [
							{
								text: 'CORS Errors',
								link: '/user-guides/troubleshooting/cors-errors',
							},
							{
								text: 'Long Message-ID Headers',
								link: '/user-guides/troubleshooting/long-message-id',
							},
						],
					},
				],
			},
			{
				text: 'Enterprise Features',
				items: [
					{ text: 'Upgrading to Enterprise', link: '/enterprise/upgrade/guide' },
					{
						text: 'Audit Log',
						link: '/enterprise/audit-log/',
						collapsed: true,
						items: [
							{ text: 'User Interface', link: '/enterprise/audit-log/guide' },
							{ text: 'API Endpoints', link: '/enterprise/audit-log/api' },
							{
								text: 'Backend Implementation',
								link: '/enterprise/audit-log/audit-service',
							},
						],
					},
					{
						text: 'Legal Holds',
						link: '/enterprise/legal-holds/',
						collapsed: true,
						items: [
							{ text: 'User Interface', link: '/enterprise/legal-holds/guide' },
							{ text: 'API Endpoints', link: '/enterprise/legal-holds/api' },
						],
					},
					{
						text: 'Retention Policy',
						link: '/enterprise/retention-policy/',
						collapsed: true,
						items: [
							{ text: 'User Interface', link: '/enterprise/retention-policy/guide' },
							{ text: 'API Endpoints', link: '/enterprise/retention-policy/api' },
							{
								text: 'Lifecycle Worker',
								link: '/enterprise/retention-policy/lifecycle-worker',
							},
							{
								text: 'Backend Implementation',
								link: '/enterprise/retention-policy/retention-service',
							},
						],
					},
					{
						text: 'Retention Labels',
						link: '/enterprise/retention-labels/',
						collapsed: true,
						items: [
							{ text: 'User Interface', link: '/enterprise/retention-labels/guide' },
							{
								text: 'Automated Application',
								link: '/enterprise/retention-labels/automated-tagging',
							},
							{ text: 'API Endpoints', link: '/enterprise/retention-labels/api' },
						],
					},
					{ text: 'SMTP Journaling', link: '/enterprise/journaling/guide' },
					{ text: 'Seat Counting', link: '/enterprise/seats/guide' },
					{
						text: 'Single Sign-On',
						link: '/enterprise/sso/guide',
						collapsed: true,
						items: [
							{ text: 'Examples', link: '/enterprise/sso/examples/' },
							{
								text: 'Google Workspace',
								link: '/enterprise/sso/examples/google-workspace',
							},
							{
								text: 'Google Workspace via Okta',
								link: '/enterprise/sso/examples/google-workspace-okta',
							},
							{
								text: 'Microsoft 365 (Entra ID)',
								link: '/enterprise/sso/examples/microsoft-365',
							},
							{
								text: 'Microsoft 365 via Okta',
								link: '/enterprise/sso/examples/microsoft-365-okta',
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
					{ text: 'Upload', link: '/api/upload' },
					{ text: 'Jobs', link: '/api/jobs' },
					{ text: 'Index Admin', link: '/api/index-admin' },
					{ text: 'Users', link: '/api/users' },
					{ text: 'IAM', link: '/api/iam' },
					{ text: 'API Keys', link: '/api/api-keys' },
					{ text: 'Settings', link: '/api/settings' },
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
