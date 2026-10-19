import { ensureSystemSettingsRow, mergeSystemSettingsConfig } from '../database/systemSettingsRow';
import type { PublicSystemSettings, SystemSettings, User } from '@open-archiver/types';
import { AuditService } from './AuditService';

/**
 * The only keys this API may write or return.
 *
 * The `system_settings.config` blob is shared with state that is not the caller's to set or
 * see: the seat policy and seat report, and on enterprise the deployment's `instanceId`, the
 * license verdict and the advanced security policy. Without this allowlist a settings PUT could
 * overwrite any of them, and the unauthenticated GET that every page load makes would disclose
 * them all.
 */
const EDITABLE_SETTING_KEYS = ['language', 'theme', 'supportEmail', 'dateFormat'] as const;

export class SettingsService {
	private auditService = new AuditService();

	/** Narrows the stored config down to the publicly visible settings. */
	private toPublicSettings(config: SystemSettings): PublicSystemSettings {
		return {
			language: config.language,
			theme: config.theme,
			supportEmail: config.supportEmail ?? null,
			dateFormat: config.dateFormat ?? 'language',
		};
	}

	/**
	 * The publicly visible system settings. The singleton row is created with defaults when the
	 * table is empty, race-safely, so every caller sees the same row.
	 */
	public async getSystemSettings(): Promise<PublicSystemSettings> {
		const row = await ensureSystemSettingsRow();
		return this.toPublicSettings(row.config);
	}

	/**
	 * Updates the public settings and returns them.
	 *
	 * Only the keys in EDITABLE_SETTING_KEYS are written; anything else is dropped. The write is a
	 * single JSONB merge rather than a read-modify-write, so a seat report or policy saved by
	 * another process between the read and the write is not lost.
	 */
	public async updateSystemSettings(
		newConfig: Partial<PublicSystemSettings>,
		actor: User,
		actorIp: string
	): Promise<PublicSystemSettings> {
		const existing = await ensureSystemSettingsRow();
		const currentConfig = existing.config;

		const allowedUpdate: Record<string, unknown> = {};
		for (const key of EDITABLE_SETTING_KEYS) {
			if (Object.prototype.hasOwnProperty.call(newConfig, key)) {
				allowedUpdate[key] = newConfig[key];
			}
		}

		if (Object.keys(allowedUpdate).length === 0) {
			return this.toPublicSettings(currentConfig);
		}

		const updatedConfig = await mergeSystemSettingsConfig(allowedUpdate);

		const changedFields = Object.keys(allowedUpdate).filter(
			(key) => currentConfig[key as keyof SystemSettings] !== allowedUpdate[key]
		);

		if (changedFields.length > 0) {
			await this.auditService.createAuditLog({
				actorIdentifier: actor.id,
				actionType: 'UPDATE',
				targetType: 'SystemSettings',
				targetId: 'system',
				actorIp,
				details: {
					changedFields,
				},
			});
		}

		return this.toPublicSettings(updatedConfig);
	}
}
