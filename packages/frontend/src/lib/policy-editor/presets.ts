import type { CaslPolicy } from '@open-archiver/types';
import { CURRENT_USER_PLACEHOLDER } from './catalog';

/**
 * Starter policies offered when a role has no statements yet.
 *
 * These mirror the roles the system ships with, so they carry no environment-specific ids and
 * can be applied on any instance. Each one is a normal starting point that stays fully editable.
 */
export interface PolicyPreset {
	/** Key under `app.components.role_form` holding the display name. */
	labelKey: string;
	policies: CaslPolicy[];
}

export const POLICY_PRESETS: readonly PolicyPreset[] = [
	{
		labelKey: 'preset_admin',
		policies: [{ action: 'manage', subject: 'all' }],
	},
	{
		labelKey: 'preset_read_only',
		policies: [
			{
				action: ['read', 'search'],
				subject: ['ingestion', 'archive', 'dashboard', 'users', 'roles'],
			},
		],
	},
	{
		labelKey: 'preset_ingestion_admin',
		policies: [{ action: 'manage', subject: 'ingestion' }],
	},
	{
		labelKey: 'preset_end_user',
		policies: [
			{ action: 'read', subject: 'dashboard' },
			{ action: 'create', subject: 'ingestion' },
			{
				action: 'manage',
				subject: 'ingestion',
				conditions: { userId: CURRENT_USER_PLACEHOLDER },
			},
			// Kept identical to the "End user" role the backend seeds in
			// IamController.createDefaultRoles, so the template and the shipped role never drift.
			{
				action: 'manage',
				subject: 'archive',
				conditions: { 'ingestionSource.userId': CURRENT_USER_PLACEHOLDER },
			},
		],
	},
];
