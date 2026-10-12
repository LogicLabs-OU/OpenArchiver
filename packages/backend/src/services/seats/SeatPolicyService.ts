import { asc } from 'drizzle-orm';
import { db } from '../../database';
import { mergeSystemSettingsConfig } from '../../database/systemSettingsRow';
import { systemSettings } from '../../database/schema/system-settings';
import type { SeatPolicy } from '@open-archiver/types';

const DEFAULT_POLICY: SeatPolicy = {
	organizationDomainGroups: [],
	additionalRoleLocalParts: [],
};

/**
 * Manages the organization-wide seat policy, stored in `system_settings.config.seat_policy`.
 *
 * Deliberately shaped like TotpPolicyService: the same column holds user preferences, the security
 * policy, the deployment id and the license status, so every writer has to merge in SQL rather
 * than read-modify-write the whole object.
 */
export class SeatPolicyService {
	public async getPolicy(): Promise<SeatPolicy> {
		const rows = await db
			.select()
			.from(systemSettings)
			.orderBy(asc(systemSettings.id))
			.limit(1);
		if (rows.length === 0) {
			return { ...DEFAULT_POLICY };
		}

		const stored = rows[0].config.seat_policy;
		if (!stored) {
			return { ...DEFAULT_POLICY };
		}

		return { ...DEFAULT_POLICY, ...stored };
	}

	public async updatePolicy(updates: Partial<SeatPolicy>): Promise<SeatPolicy> {
		const current = await this.getPolicy();
		const merged: SeatPolicy = {
			...current,
			...updates,
			updatedAt: new Date().toISOString(),
		};

		// Merged in SQL via the shared helper: writing the whole config object back would discard
		// fields set by a concurrent writer between the read and the write — most damagingly the
		// instance id and the license status.
		await mergeSystemSettingsConfig({ seat_policy: merged });

		return merged;
	}
}

export const seatPolicyService = new SeatPolicyService();
