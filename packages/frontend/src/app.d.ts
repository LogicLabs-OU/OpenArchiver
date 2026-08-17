import type { User } from '@open-archiver/types';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
			/**
			 * Marks an error raised because the page belongs to the Enterprise Edition, so
			 * `dashboard/+error.svelte` can answer with the upgrade notice instead of the failure
			 * alert. The status alone cannot carry this: a 403 is just as likely to mean the user
			 * lacks a permission, and telling them to buy an edition they already own would be
			 * worse than saying nothing.
			 *
			 * This shape is a contract with the enterprise repository, which shares this frontend.
			 * See lib/server/enterprise-gate.md before changing it.
			 */
			code?: 'enterprise_only';
			/** Translation key for the feature name. Resolved in the component, not the loader. */
			featureKey?: string;
			/** Translation key for the line explaining what the feature does. */
			pitchKey?: string;
		}
		interface Locals {
			user: Omit<User, 'passwordHash'> | null;
			accessToken: string | null;
			enterpriseMode: boolean | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
