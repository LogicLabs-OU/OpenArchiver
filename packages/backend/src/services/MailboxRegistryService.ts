import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { IngestionSource, MailboxDirectoryFacts, MailboxUser } from '@open-archiver/types';
import { db } from '../database';
import { ingestionSources } from '../database/schema/ingestion-sources';
import { mailboxes } from '../database/schema/mailboxes';
import { logger } from '../config/logger';
import { normalizeEmailAddress } from '../helpers/emailAddress';
import { mapWithConcurrency } from '../helpers/mapWithConcurrency';

/** Rows written per statement. A hundred-thousand-user tenant must not become one giant insert. */
const UPSERT_PAGE_SIZE = 500;

/** Purpose lookups in flight at once. Each is its own Graph round trip. */
const PURPOSE_CONCURRENCY = 5;

/** Purpose lookups per cycle, so a first sync of a large tenant spreads over several cycles. */
const PURPOSE_BUDGET_PER_CYCLE = 200;

/** How long a known purpose is trusted before it is read again. */
const PURPOSE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long to stop asking after Graph refused, in case the permission is granted later. */
const FORBIDDEN_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** A connector that can say what a mailbox is for. Only the Microsoft one implements it. */
interface PurposeCapableConnector {
	getMailboxPurpose(userId: string): Promise<MailboxDirectoryFacts['purpose']>;
}

const canReadPurpose = (connector: unknown): connector is PurposeCapableConnector =>
	typeof (connector as PurposeCapableConnector)?.getMailboxPurpose === 'function';

/**
 * Records what each provider's directory says about the mailboxes it lists.
 *
 * This is the OSS half of seat accounting. It writes provider facts and nothing else — no
 * classification, no identity grouping, no notion of a seat — because the ingestion worker that
 * calls it loads no enterprise code, and because facts and judgements must not be written by the
 * same hand: an administrator can declare things through the enterprise API, and those
 * declarations have to stay distinguishable from what the directory actually said.
 *
 * Nothing here is on the per-message path. It runs once per mailbox per sync cycle, beside the
 * listing that was going to happen anyway.
 */
export class MailboxRegistryService {
	/**
	 * Records the mailboxes a directory listing returned.
	 *
	 * Called before the mailbox jobs are enqueued, so a mailbox is known before its first message
	 * is archived. Provider columns are overwritten on every listing — that is what makes a
	 * mailbox converted upstream (a shared mailbox given to a new hire) correct itself on the next
	 * cycle rather than keeping a stale classification for ever.
	 */
	public static async upsertFromDirectory(
		source: IngestionSource,
		users: MailboxUser[],
		connector?: unknown
	): Promise<void> {
		const rootSourceId = source.mergedIntoId ?? source.id;
		const now = new Date();

		// Folded by address first: Postgres refuses an upsert that touches one row twice in the
		// same statement, so a directory returning an address under two objects would otherwise
		// fail the whole page of mailboxes it arrived in. The last listing wins.
		const byAddress = new Map<string, MailboxUser>();
		for (const user of users) {
			const address = normalizeEmailAddress(user.primaryEmail ?? '');
			if (address.length > 0) {
				byAddress.set(address, user);
			}
		}

		const rows = [...byAddress.entries()].map(([address, user]) => ({
			address,
			displayName: user.displayName || null,
			provider: source.provider,
			sourceId: source.id,
			rootSourceId,
			providerObjectId: user.id || null,
			providerAliases: (user.directory?.aliases ?? []).filter((a) => a !== address),
			licensed: user.directory?.licensed ?? null,
			accountEnabled: user.directory?.accountEnabled ?? null,
			lastListedAt: now,
			// A brand-new row starts as its own identity; reconciliation regroups it.
			identityKey: address,
		}));

		if (rows.length === 0) {
			return;
		}

		for (let i = 0; i < rows.length; i += UPSERT_PAGE_SIZE) {
			await db
				.insert(mailboxes)
				.values(rows.slice(i, i + UPSERT_PAGE_SIZE))
				.onConflictDoUpdate({
					target: mailboxes.address,
					// Provider-owned columns only. `kind`, `identityKey` and every admin column
					// are deliberately absent: a listing must never overwrite a declaration or a
					// resolved grouping.
					set: {
						displayName: sql`excluded.display_name`,
						provider: sql`excluded.provider`,
						sourceId: sql`excluded.source_id`,
						rootSourceId: sql`excluded.root_source_id`,
						providerObjectId: sql`excluded.provider_object_id`,
						providerAliases: sql`excluded.provider_aliases`,
						licensed: sql`excluded.licensed`,
						accountEnabled: sql`excluded.account_enabled`,
						lastListedAt: sql`excluded.last_listed_at`,
						updatedAt: now,
					},
				});
		}

		logger.info(
			{ ingestionSourceId: source.id, mailboxes: rows.length },
			'Recorded directory mailboxes for seat accounting'
		);

		await this.refreshPurposes(source, connector);
	}

	/**
	 * Asks the provider what kind of mailbox each unclassified address is.
	 *
	 * Separate from the listing because it costs one request per mailbox: run for every user on
	 * every cycle it would be thousands of extra calls on a large tenant. Only rows never asked,
	 * or asked more than a week ago, are asked, never-asked first, and only a bounded number per
	 * cycle — so a first sync fills in over a few cycles instead of stalling one. A row is marked
	 * asked even when Graph had no purpose to give, or a few hundred such rows would take the
	 * whole budget every cycle and the rest of the tenant would never be reached.
	 *
	 * A tenant that has not granted MailboxSettings.Read refuses all of them. That is a
	 * configuration state, not an outage: the first refusal stops the pass, is logged once, and is
	 * remembered on the source so the next cycles skip it entirely.
	 */
	private static async refreshPurposes(
		source: IngestionSource,
		connector?: unknown
	): Promise<void> {
		if (!canReadPurpose(connector)) {
			return;
		}

		const forbiddenAt = source.syncState?.mailboxSettingsForbiddenAt;
		if (forbiddenAt && Date.now() - new Date(forbiddenAt).getTime() < FORBIDDEN_RETRY_MS) {
			return;
		}

		const staleBefore = new Date(Date.now() - PURPOSE_TTL_MS);
		const candidates = await db
			.select({
				id: mailboxes.id,
				address: mailboxes.address,
				providerObjectId: mailboxes.providerObjectId,
			})
			.from(mailboxes)
			.where(
				and(
					eq(mailboxes.rootSourceId, source.mergedIntoId ?? source.id),
					or(
						isNull(mailboxes.purposeCheckedAt),
						lt(mailboxes.purposeCheckedAt, staleBefore)
					)
				)
			)
			.orderBy(sql`${mailboxes.purposeCheckedAt} asc nulls first`, asc(mailboxes.address))
			.limit(PURPOSE_BUDGET_PER_CYCLE);

		if (candidates.length === 0) {
			return;
		}

		let forbidden = false;
		const results = await mapWithConcurrency(
			candidates,
			PURPOSE_CONCURRENCY,
			async (candidate) => {
				// Once one call has been refused, every other call this cycle would be refused
				// too. Skipping them keeps a misconfigured tenant from spending its whole
				// Graph budget learning the same thing several hundred times.
				if (forbidden) {
					return null;
				}
				try {
					return await connector.getMailboxPurpose(
						candidate.providerObjectId ?? candidate.address
					);
				} catch (error) {
					if ((error as Error)?.name === 'MailboxSettingsForbiddenError') {
						forbidden = true;
						return null;
					}
					throw error;
				}
			}
		);

		if (forbidden) {
			logger.warn(
				{ ingestionSourceId: source.id },
				'Mailbox purposes are not readable for this source; grant MailboxSettings.Read to let shared mailboxes be detected automatically. Classification falls back to license state.'
			);
			await db
				.update(ingestionSources)
				.set({
					syncState: sql`coalesce(${ingestionSources.syncState}, '{}'::jsonb) || ${JSON.stringify(
						{ mailboxSettingsForbiddenAt: new Date().toISOString() }
					)}::jsonb`,
					updatedAt: new Date(),
				})
				.where(eq(ingestionSources.id, source.id));
			return;
		}

		const checkedAt = new Date();
		let classified = 0;
		for (const [index, result] of results.entries()) {
			if (result.status === 'rejected') {
				logger.warn(
					{ err: result.reason, address: candidates[index].address },
					'Could not read mailbox purpose'
				);
				continue;
			}
			const purpose = result.value;
			// No purpose keeps whatever classification the row already has; only the check time
			// moves, so the row waits its turn like the others instead of being asked again at once.
			await db
				.update(mailboxes)
				.set({
					...(purpose && { providerKind: purpose }),
					purposeCheckedAt: checkedAt,
					updatedAt: checkedAt,
				})
				.where(eq(mailboxes.id, candidates[index].id));
			if (purpose) {
				classified++;
			}
		}

		if (classified > 0) {
			logger.info(
				{ ingestionSourceId: source.id, classified },
				'Refreshed provider mailbox classifications'
			);
		}
	}

	/**
	 * Records that an address the directory listed owns no mailbox to archive.
	 *
	 * An unlicensed Entra ID member with a mailbox is what an Exchange shared mailbox looks like
	 * to a tenant that has not granted MailboxSettings.Read, so telling "no licence, has emails"
	 * apart from "no licence, no mailbox at all" is what keeps that inference sound.
	 */
	public static async markNoMailbox(address: string): Promise<void> {
		const normalized = normalizeEmailAddress(address);
		if (!normalized) {
			return;
		}
		await db
			.update(mailboxes)
			.set({ hasMailbox: false, updatedAt: new Date() })
			.where(eq(mailboxes.address, normalized));
	}

	/**
	 * Records that a fetch reached this address's mailbox.
	 *
	 * The counterpart of `markNoMailbox`, so `hasMailbox` always reflects the latest fetch rather
	 * than whatever was once true. Set from the fetch outcome, not from archived emails: an account
	 * whose mailbox was removed still has its emails in the archive, and that is exactly the case
	 * `hasMailbox === false` exists to recognise.
	 */
	public static async markHasMailbox(address: string): Promise<void> {
		const normalized = normalizeEmailAddress(address);
		if (!normalized) {
			return;
		}
		await db
			.update(mailboxes)
			.set({ hasMailbox: true, updatedAt: new Date() })
			.where(
				and(
					eq(mailboxes.address, normalized),
					or(isNull(mailboxes.hasMailbox), eq(mailboxes.hasMailbox, false))
				)
			);
	}
}
