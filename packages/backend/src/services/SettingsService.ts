import { asc } from 'drizzle-orm';
import { db } from '../database';
import { systemSettings } from '../database/schema/system-settings';
import { ensureSystemSettingsRow, mergeSystemSettingsConfig } from '../database/systemSettingsRow';
import type { PublicSystemSettings, SystemSettings, User } from '@open-archiver/types';
import { AuditService } from './AuditService';

/**
 * The only keys this API may write or return.
 *
 * The `system_settings.config` blob is shared with state that is not the user's
 * to set or see: the deployment's `instanceId`, the license verdict
 * (`licenseStatus`), and the advanced security policy. Without this allowlist a
 * caller could overwrite the license status through the settings PUT, and every
 * unauthenticated GET would disclose it.
 */
const EDITABLE_SETTING_KEYS = ['language', 'theme', 'supportEmail'] as const;

export class SettingsService {
	private auditService = new AuditService();

	/** Narrows the stored config down to the publicly visible settings. */
	private toPublicSettings(config: SystemSettings): PublicSystemSettings {
		return {
			language: config.language,
			theme: config.theme,
			supportEmail: config.supportEmail ?? null,
		};
	}

	/**
	 * Retrieves the publicly visible system settings.
	 * If no settings exist, it initializes and returns the default settings.
	 */
	public async getSystemSettings(): Promise<PublicSystemSettings> {
		const settings = await db
			.select()
			.from(systemSettings)
			.orderBy(asc(systemSettings.id))
			.limit(1);

		if (settings.length === 0) {
			return this.toPublicSettings(await this.createDefaultSystemSettings());
		}

		return this.toPublicSettings(settings[0].config);
	}

	/**
	 * Returns the full stored config, including keys the public API never exposes.
	 * For internal callers only — never send this to a client.
	 */
	public async getInternalSystemSettings(): Promise<SystemSettings> {
		const row = await ensureSystemSettingsRow();
		return row.config;
	}

	/**
	 * Updates the system settings by merging the new configuration with the existing one.
	 *
	 * Only the keys in EDITABLE_SETTING_KEYS are written; anything else in the
	 * request body is dropped. The caller is a request handler, so treat the input
	 * as hostile: the same JSONB blob also holds the license verdict and the
	 * deployment's instanceId.
	 *
	 * @param newConfig - A partial object of the new settings configuration.
	 * @returns The publicly visible settings after the update.
	 */
	public async updateSystemSettings(
		newConfig: Partial<SystemSettings>,
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
			(key) =>
				currentConfig[key as keyof SystemSettings] !==
				allowedUpdate[key as keyof SystemSettings]
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

	/**
	 * Creates and saves the default system settings.
	 * This is called internally when no settings are found.
	 * @returns The newly created default settings.
	 */
	private async createDefaultSystemSettings(): Promise<SystemSettings> {
		// The settings row is a singleton. ensureSystemSettingsRow() inserts it
		// idempotently (only when the table is empty) and race-safely, so
		// concurrent callers — or InstanceIdService / TotpPolicyService on a
		// fresh database — never create duplicate rows.
		const row = await ensureSystemSettingsRow();
		return row.config;
	}
}
