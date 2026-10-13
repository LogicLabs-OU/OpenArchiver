import { createHash } from 'crypto';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../database';
import { logger } from '../../config/logger';
import { mailboxes } from '../../database/schema/mailboxes';
import { journalingSources } from '../../database/schema/journaling-sources';
import { users } from '../../database/schema/users';
import { mergeSystemSettingsConfig } from '../../database/systemSettingsRow';
import { systemSettings } from '../../database/schema/system-settings';
import type { OrganizationDomainGroup, SeatPolicy, SeatReport } from '@open-archiver/types';
import { computeSeats, type SeatMailbox } from './seatRules';
import { DEFAULT_ROLE_LOCAL_PARTS, effectiveRoleLocalParts } from './roleLocalParts';
import { seatPolicyService } from './SeatPolicyService';

/** Rows written per statement when the resolved classification is persisted. */
const WRITE_PAGE_SIZE = 500;

/**
 * A mailbox no directory has listed for this long is reported as departed, and its licence state
 * is no longer trusted to classify it (see `isUnlisted` in seatRules.ts).
 */
export const DEPARTED_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A stable, unsalted digest of a role word (`frontdesk`), never of an address.
 *
 * Unsalted on purpose: the vendor tests candidate words against it, which a salt would prevent,
 * and a role word is not personal data. Addresses are a different matter — the customer's domain
 * is known from the licence, so an unsalted hash of `name@domain` is reversible by guessing names,
 * which is why no address-derived value is sent at all.
 */
const hashRoleWord = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface SeatReconciliation {
	report: SeatReport;
	/** sha256 of each role local part the administrator added to the defaults. */
	adminPatternExtensions: string[];
}

/**
 * Works out how many people a deployment is archiving for.
 *
 * A seat used to be `count(DISTINCT user_email)`, which charges for every `info@` address and
 * charges twice for anyone who has a mailbox on two of the company's domains. This service
 * replaces that with a count of *identities*: mailboxes are classified (person, shared, room,
 * equipment) and grouped (one person may own several addresses), and only groups containing a
 * real, still-archiving person are billed.
 *
 * None of the reductions are taken on trust. The full breakdown — how many mailboxes were
 * excluded, by which rule, and hashes of everything an administrator declared by hand — is sent to
 * the license server, which decides whether the reductions are plausible. This instance never
 * judges its own numbers, and never refuses a declaration on the grounds of quantity.
 */
export class SeatAccountingService {
	/** Single-flight, so several callers in one process share one run rather than queueing scans. */
	#inFlight: Promise<SeatReconciliation> | null = null;

	/**
	 * Brings the registry in line with what is actually archived, then reclassifies everything.
	 *
	 * Runs before each phone-home and on demand from the admin page. The archive scan is the
	 * expensive half, so administrator actions call `recomputeIdentities()` directly instead.
	 */
	public async reconcile(): Promise<SeatReconciliation> {
		if (this.#inFlight) {
			return this.#inFlight;
		}
		this.#inFlight = (async () => {
			try {
				await this.syncFromArchive();
				return await this.recomputeIdentities();
			} finally {
				this.#inFlight = null;
			}
		})();
		return this.#inFlight;
	}

	/** Whether a reconciliation is running in this process right now. */
	public get isReconciling(): boolean {
		return this.#inFlight !== null;
	}

	/**
	 * Records which mailboxes still hold archived emails.
	 *
	 * The aggregate is materialised once into a temporary table and then read twice — once to
	 * insert or refresh the mailboxes that have emails, once to retire those that no longer do.
	 * Running two independent statements would scan `archived_emails` twice, and on a
	 * tens-of-millions-of-rows archive that is the whole cost of this operation.
	 *
	 * Guarded by a transaction-scoped advisory lock: several nodes phone home independently, and
	 * two concurrent reconciliations would race on the same rows to no purpose.
	 */
	private async syncFromArchive(): Promise<void> {
		await db.transaction(async (tx) => {
			const [{ locked }] = (await tx.execute(
				sql`select pg_try_advisory_xact_lock(hashtext('oa:seat-reconcile')) as locked`
			)) as unknown as { locked: boolean }[];

			if (!locked) {
				logger.info('Seat reconciliation already running on another node; skipping scan.');
				return;
			}

			await tx.execute(sql`
				create temporary table live_mailboxes on commit drop as
				select
					lower(btrim(user_email)) as address,
					-- Cast through text because Postgres has no min() for uuid. Any one source
					-- will do: it only seeds provider and source on first insert, and a directory
					-- listing overwrites both with the authoritative values.
					(min(ingestion_source_id::text))::uuid as source_id,
					count(*) as email_count,
					max(archived_at) as last_archived_at
				from archived_emails
				group by 1
			`);

			// has_mailbox is deliberately not written here. Archived emails prove a mailbox once
			// existed, not that it still does, and "unlicensed, mailbox gone, emails kept" is the
			// offboarded-person case it exists to recognise. The fetch outcome sets it
			// (MailboxRegistryService.markHasMailbox / markNoMailbox).
			await tx.execute(sql`
				insert into mailboxes (
					address, provider, source_id, root_source_id,
					is_sentinel, active, email_count, last_archived_at, identity_key
				)
				select
					l.address,
					s.provider,
					s.id,
					coalesce(s.merged_into_id, s.id),
					l.address in ('default', 'journal-unknown')
						or l.address like 'default\\_fallback@%',
					true,
					l.email_count,
					l.last_archived_at,
					l.address
				from live_mailboxes l
				join ingestion_sources s on s.id = l.source_id
				on conflict (address) do update set
					active = true,
					email_count = excluded.email_count,
					last_archived_at = excluded.last_archived_at,
					is_sentinel = excluded.is_sentinel,
					updated_at = now()
			`);

			// A mailbox whose last archived message has been deleted stops being billable. Its row
			// stays, so an administrator's classification and links survive if emails are archived
			// for it again.
			await tx.execute(sql`
				update mailboxes set active = false, email_count = 0, updated_at = now()
				where active = true
				  and not exists (
					select 1 from live_mailboxes l where l.address = mailboxes.address
				  )
			`);
		});
	}

	/**
	 * Reclassifies and regroups every registered mailbox, and stores the result.
	 *
	 * Cheap enough to run after every administrator action: the registry holds one row per
	 * mailbox — thousands, not millions — so the whole decision is made in memory by the pure
	 * functions in seatRules.ts.
	 */
	public async recomputeIdentities(): Promise<SeatReconciliation> {
		const policy = await seatPolicyService.getPolicy();
		const [domainGroups, loginUserEmails] = await Promise.all([
			this.effectiveDomainGroups(policy),
			this.loginUserEmails(),
		]);

		const rows = await db.select().from(mailboxes).orderBy(asc(mailboxes.address));

		const inputs: SeatMailbox[] = rows.map((row) => ({
			id: row.id,
			address: row.address,
			provider: row.provider,
			rootSourceId: row.rootSourceId,
			providerObjectId: row.providerObjectId,
			providerAliases: row.providerAliases ?? [],
			providerKind: row.providerKind,
			licensed: row.licensed,
			hasMailbox: row.hasMailbox,
			active: row.active,
			isSentinel: row.isSentinel,
			adminKind: row.adminKind,
			linkedToMailboxId: row.linkedToMailboxId,
			lastListedAt: row.lastListedAt,
			createdAt: row.createdAt,
		}));

		const defaultRoleLocalParts = new Set(DEFAULT_ROLE_LOCAL_PARTS);
		const roleLocalParts = effectiveRoleLocalParts(policy.additionalRoleLocalParts);

		const { resolved, report } = computeSeats(inputs, {
			roleLocalParts,
			defaultRoleLocalParts,
			domainGroups,
			loginUserEmails,
			purposeSignalAvailable: rows.some((row) => row.providerKind !== null),
			departedBefore: new Date(Date.now() - DEPARTED_AFTER_MS),
		});

		const changed = rows.filter((row) => {
			const next = resolved.get(row.id);
			return (
				next &&
				(row.kind !== next.kind ||
					row.kindEvidence !== next.evidence ||
					row.identityKey !== next.identityKey ||
					row.identityEvidence !== next.identityEvidence)
			);
		});

		for (let i = 0; i < changed.length; i += WRITE_PAGE_SIZE) {
			const page = changed.slice(i, i + WRITE_PAGE_SIZE);
			// One statement per page rather than one per row: the first reconciliation of an
			// existing archive classifies every mailbox at once, and a round trip each would be
			// thousands of them.
			const values = sql.join(
				page.map((row) => {
					const next = resolved.get(row.id)!;
					return sql`(${row.id}::uuid, ${next.kind}::mailbox_kind, ${next.evidence}::mailbox_kind_evidence, ${next.identityKey}::text, ${next.identityEvidence}::seat_identity_evidence)`;
				}),
				sql`, `
			);
			await db.execute(sql`
				update mailboxes set
					kind = v.kind,
					kind_evidence = v.kind_evidence,
					identity_key = v.identity_key,
					identity_evidence = v.identity_evidence,
					updated_at = now()
				from (values ${values}) as v(id, kind, kind_evidence, identity_key, identity_evidence)
				where mailboxes.id = v.id
			`);
		}

		// Counters only. The row this lands in is read on every page load, and the hashed address
		// lists belong in the phone-home body rather than in shared settings.
		await mergeSystemSettingsConfig({ seat_report: report });

		const declarations = this.collectDeclarations(policy, defaultRoleLocalParts);

		logger.info(
			{
				seats: report.seats,
				rawMailboxes: report.rawMailboxes,
				excluded: report.excluded,
				reclassified: changed.length,
			},
			'Seat accounting reconciled'
		);

		return { report, ...declarations };
	}

	/**
	 * The stored report for the admin page, refreshed in the background when it is older than
	 * `maxAgeMs`.
	 *
	 * The scan reads all of `archived_emails`, which on a large archive takes longer than an HTTP
	 * request may, so a stale report is returned as it is and the recount runs behind it; the page
	 * says a recount is running and the next load shows the result. Only when no report exists at
	 * all — the first visit after an upgrade, once per deployment — is the scan awaited, because
	 * there is nothing else to show. The single-flight in `reconcile()` and the advisory lock inside
	 * it keep repeated page loads, or several nodes, from running the scan more than once.
	 */
	public async reconcileIfStale(maxAgeMs: number): Promise<SeatReport | null> {
		const stored = await this.getStoredReport();
		if (!stored) {
			const { report } = await this.reconcile();
			return report;
		}
		if (!this.isFresh(stored, maxAgeMs)) {
			this.reconcile().catch((error) =>
				logger.error({ err: error }, 'Background seat reconciliation failed')
			);
		}
		return stored;
	}

	/**
	 * A reconciliation for the phone-home, reusing the stored report when it is younger than
	 * `maxAgeMs` instead of scanning the archive again.
	 *
	 * For the ping sent at process start: a restart, a deploy or a crash loop would otherwise scan
	 * the whole archive each time, and the advisory lock only keeps nodes from scanning *at once*,
	 * not one after another. The declarations are cheap to rebuild from the policy, so a reused
	 * report travels with current ones.
	 */
	public async reconcileUnlessFresh(maxAgeMs: number): Promise<SeatReconciliation> {
		const stored = await this.getStoredReport();
		if (stored && this.isFresh(stored, maxAgeMs)) {
			const policy = await seatPolicyService.getPolicy();
			return {
				report: stored,
				...this.collectDeclarations(policy, new Set(DEFAULT_ROLE_LOCAL_PARTS)),
			};
		}
		return this.reconcile();
	}

	private isFresh(report: SeatReport, maxAgeMs: number): boolean {
		const computedAt = new Date(report.computedAt).getTime();
		return Number.isFinite(computedAt) && Date.now() - computedAt < maxAgeMs;
	}

	/** The stored report, or null before the first reconciliation. */
	public async getStoredReport(): Promise<SeatReport | null> {
		const rows = await db
			.select()
			.from(systemSettings)
			.orderBy(asc(systemSettings.id))
			.limit(1);
		return rows[0]?.config.seat_report ?? null;
	}

	/**
	 * Distinct archived mailboxes, sentinels excluded.
	 *
	 * The fallback when reconciliation itself fails, and the cross-check for `rawMailboxes`. It
	 * differs from the count this replaced in two ways that were plain faults: the address is
	 * normalised in SQL, so one mailbox archived under two casings is one mailbox; and the
	 * invented addresses the archive falls back to when no owner could be resolved are not
	 * counted as people.
	 */
	public async countDistinctMailboxes(): Promise<number> {
		const result = (await db.execute(sql`
			select count(distinct lower(btrim(user_email)))::int as count
			from archived_emails
			where lower(btrim(user_email)) not in ('default', 'journal-unknown')
			  and lower(btrim(user_email)) not like 'default\\_fallback@%'
		`)) as unknown as { count: number }[];
		return result[0]?.count ?? 0;
	}

	/**
	 * Every domain group in force: the seats policy plus each journaling source's own.
	 *
	 * Folded together so an organization that already told the journaling endpoint which domains
	 * are alias domains does not have to say it a second time for billing.
	 */
	private async effectiveDomainGroups(policy: SeatPolicy): Promise<OrganizationDomainGroup[]> {
		const journalRows = await db
			.select({ organizationDomains: journalingSources.organizationDomains })
			.from(journalingSources);

		const byPrimary = new Map<string, Set<string>>();
		const add = (group: OrganizationDomainGroup): void => {
			const primary = (group.main ?? '').trim().toLowerCase();
			if (!primary) {
				return;
			}
			const aliases = byPrimary.get(primary) ?? new Set<string>();
			for (const alias of group.aliases ?? []) {
				const normalized = (alias ?? '').trim().toLowerCase();
				if (normalized && normalized !== primary) {
					aliases.add(normalized);
				}
			}
			byPrimary.set(primary, aliases);
		};

		for (const group of policy.organizationDomainGroups ?? []) {
			add(group);
		}
		for (const row of journalRows) {
			for (const group of row.organizationDomains ?? []) {
				add(group);
			}
		}

		return [...byPrimary].map(([main, aliases]) => ({ main, aliases: [...aliases] }));
	}

	/** Every login account's address, normalised — used to spot excluded mailboxes with a person behind them. */
	private async loginUserEmails(): Promise<Set<string>> {
		const rows = await db.select({ email: users.email }).from(users);
		return new Set(rows.map((row) => row.email.trim().toLowerCase()));
	}

	/**
	 * The hashed declarations the license server judges: the role words an administrator added.
	 *
	 * Individual mailboxes are reported as counts only. Which addresses were declared shared, or
	 * excluded by an added word, stays on the instance and is answered during an audit from the
	 * Seats page and the audit log, never from the ping.
	 */
	private collectDeclarations(
		policy: SeatPolicy,
		defaultRoleLocalParts: Set<string>
	): Omit<SeatReconciliation, 'report'> {
		const additional = (policy.additionalRoleLocalParts ?? [])
			.map((part) => part.trim().toLowerCase())
			.filter((part) => part && !defaultRoleLocalParts.has(part));

		return { adminPatternExtensions: additional.map(hashRoleWord).sort() };
	}

	/** Re-reads one mailbox row, for the controller's audit entries. */
	public async findMailboxById(id: string) {
		const rows = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1);
		return rows[0] ?? null;
	}

	/** Every mailbox in the given identity groups, for the controller's link check. */
	public async findMailboxesByIdentityKeys(identityKeys: string[]) {
		if (identityKeys.length === 0) {
			return [];
		}
		return db
			.select({
				identityKey: mailboxes.identityKey,
				providerObjectId: mailboxes.providerObjectId,
				rootSourceId: mailboxes.rootSourceId,
			})
			.from(mailboxes)
			.where(inArray(mailboxes.identityKey, identityKeys));
	}

	/** One mailbox row by its canonical address, for links made by address. */
	public async findMailboxByAddress(address: string) {
		const rows = await db
			.select()
			.from(mailboxes)
			.where(eq(mailboxes.address, address))
			.limit(1);
		return rows[0] ?? null;
	}
}

export const seatAccountingService = new SeatAccountingService();
