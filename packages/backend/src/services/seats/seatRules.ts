import type {
	IngestionProvider,
	MailboxKind,
	MailboxKindEvidence,
	OrganizationDomainGroup,
	SeatIdentityEvidence,
	SeatReport,
} from '@open-archiver/types';
import { SEAT_POLICY_VERSION } from '@open-archiver/types';

/**
 * The seat-relevant facts about one mailbox.
 *
 * A plain structure rather than the Drizzle row so every rule below stays a pure function of its
 * inputs: these decide what a customer is billed, and they have to be readable, and checkable,
 * without a database.
 */
export interface SeatMailbox {
	id: string;
	address: string;
	provider: IngestionProvider;
	rootSourceId: string | null;
	providerObjectId: string | null;
	providerAliases: string[];
	providerKind: MailboxKind | null;
	licensed: boolean | null;
	hasMailbox: boolean | null;
	active: boolean;
	isSentinel: boolean;
	adminKind: MailboxKind | null;
	linkedToMailboxId: string | null;
	lastListedAt: Date | null;
	createdAt: Date;
}

/** Providers with a directory that lists mailboxes, and so can stop listing one. */
export const DIRECTORY_PROVIDERS: ReadonlySet<IngestionProvider> = new Set<IngestionProvider>([
	'google_workspace',
	'microsoft_365',
]);

/**
 * Whether a mailbox has fallen out of its directory while its emails are still archived.
 *
 * Only meaningful for providers that have a directory: an IMAP mailbox, an import or a journaling
 * address is never listed by anyone, so "not listed lately" says nothing about it. A row that has
 * never been listed counts only once it is older than the threshold, so the first reconciliation
 * after an upgrade does not report every mailbox as departed before the next sync lists them.
 */
export const isDeparted = (mailbox: SeatMailbox, departedBefore: Date): boolean =>
	mailbox.active && isUnlisted(mailbox, departedBefore);

/**
 * Whether a directory-backed mailbox has not been listed since `before`, whatever it holds.
 *
 * The licence-based inference in `deriveProviderKind` reads the licence state the directory
 * reported at its last listing. Once a directory stops listing a mailbox that state is frozen:
 * a person offboarded by removing the licence first, then deleting the account, would stay
 * "unlicensed, has a mailbox" — the shared-mailbox signature — for ever, and stop being billed
 * while their emails are kept. So the inference is withdrawn for unlisted rows.
 */
export const isUnlisted = (mailbox: SeatMailbox, before: Date): boolean => {
	if (!DIRECTORY_PROVIDERS.has(mailbox.provider)) {
		return false;
	}
	const lastSeen = mailbox.lastListedAt ?? mailbox.createdAt;
	return lastSeen < before;
};

export interface ResolvedKind {
	kind: MailboxKind;
	evidence: MailboxKindEvidence;
	/** True when a role name excluded a mailbox the provider called a person. */
	overrodeProvider: boolean;
}

/** Addresses the archive invented because no real owner could be determined. */
export const isSentinelAddress = (address: string): boolean =>
	address === 'default' ||
	address === 'journal-unknown' ||
	address.startsWith('default_fallback@');

/** The part before the last `@`, lowercased. Empty when the value is not an address. */
export const localPartOf = (address: string): string => {
	const at = address.lastIndexOf('@');
	return at <= 0 ? '' : address.slice(0, at).toLowerCase();
};

/** The part after the last `@`, lowercased. Empty when the value is not an address. */
export const domainOf = (address: string): string => {
	const at = address.lastIndexOf('@');
	return at < 0 ? '' : address.slice(at + 1).toLowerCase();
};

/**
 * What the directory itself implies about a mailbox, beyond an explicit purpose.
 *
 * The explicit answer (`providerKind`, from Exchange's userPurpose) is used when it exists, listed
 * or not: it is a positive statement about the mailbox, not an inference. When it does not exist —
 * a tenant that has not granted MailboxSettings.Read — an account holding no license that
 * nonetheless owns a mailbox is read as shared, because that is exactly how Exchange represents a
 * shared mailbox: no license is consumed, yet emails arrive. An account that holds a license is a
 * person somebody is paying for.
 *
 * `hasMailbox === false` means a fetch has already proved there is nothing there at all, which is
 * an unlicensed member rather than a shared mailbox, so no inference is drawn.
 *
 * `unlisted` withdraws the licence inference: the licence state is only as recent as the last
 * listing, and a frozen "unlicensed" is what an offboarded person looks like (see `isUnlisted`).
 * Such a mailbox falls through to the next rules and, failing those, is billed.
 */
export const deriveProviderKind = (mailbox: SeatMailbox, unlisted: boolean): MailboxKind | null => {
	if (mailbox.providerKind) {
		return mailbox.providerKind;
	}
	if (unlisted) {
		return null;
	}
	if (mailbox.licensed === false && mailbox.hasMailbox !== false) {
		return 'shared';
	}
	if (mailbox.licensed === true) {
		return 'user';
	}
	return null;
};

/**
 * Decides what one mailbox is, in a fixed precedence that decides what the customer is billed.
 *
 * The order is the whole design, so it is worth stating why it runs this way round:
 *
 *  1. A sentinel is an artefact of the archive, never a mailbox anyone owns.
 *  2. An administrator calling something a *person* is always honoured. This direction only ever
 *     increases the bill, so it needs no defence against abuse, and it is how a real person
 *     owning `info@` is handled.
 *  3. A role name excludes the mailbox. This sits above provider evidence by the product owner's
 *     decision — a licensed `info@` account is still a desk — but the disagreement is counted and
 *     reported rather than hidden, because it is also what evasion would look like.
 *  4. Provider evidence. An administrator cannot talk a licensed, purpose=user mailbox down to
 *     shared; only the directory can say that.
 *  5. An administrator calling something shared, which is therefore reachable only where the
 *     provider offered no opinion: IMAP, OAuth mailboxes, Google, imports, journaling.
 *  6. Nothing is known, so it is billed. Unknown must cost, or not answering would be the
 *     cheapest strategy.
 */
export const resolveKind = (
	mailbox: SeatMailbox,
	roleLocalParts: Set<string>,
	unlisted: boolean
): ResolvedKind => {
	if (mailbox.isSentinel) {
		return { kind: 'unknown', evidence: 'none', overrodeProvider: false };
	}

	if (mailbox.adminKind === 'user') {
		return { kind: 'user', evidence: 'admin', overrodeProvider: false };
	}

	const providerKind = deriveProviderKind(mailbox, unlisted);

	if (roleLocalParts.has(localPartOf(mailbox.address))) {
		return {
			kind: 'shared',
			evidence: 'pattern',
			overrodeProvider: providerKind === 'user',
		};
	}

	if (providerKind) {
		return { kind: providerKind, evidence: 'provider', overrodeProvider: false };
	}

	if (mailbox.adminKind === 'shared') {
		return { kind: 'shared', evidence: 'admin', overrodeProvider: false };
	}

	return { kind: 'unknown', evidence: 'none', overrodeProvider: false };
};

/** A mailbox kind that represents a person, and therefore costs a seat. */
export const kindCountsAsPerson = (kind: MailboxKind): boolean =>
	kind === 'user' || kind === 'unknown';

/**
 * Maps every domain of every configured group to its primary domain.
 *
 * Built from the seats policy and every journaling source's own groups folded together, so a
 * domain already configured for journaling does not have to be entered twice.
 */
export const buildDomainToPrimary = (
	groups: readonly OrganizationDomainGroup[]
): Map<string, string> => {
	const map = new Map<string, string>();
	for (const group of groups) {
		const primary = (group.main ?? '').trim().toLowerCase();
		if (!primary) {
			continue;
		}
		map.set(primary, primary);
		for (const alias of group.aliases ?? []) {
			const normalized = (alias ?? '').trim().toLowerCase();
			// A domain already claimed as another group's primary is left alone: one domain
			// cannot canonicalise to two different places, and silently reassigning it would
			// merge two organizations.
			if (normalized && !map.has(normalized)) {
				map.set(normalized, primary);
			}
		}
	}
	return map;
};

/** The address rewritten onto its primary domain, when its domain belongs to a group. */
export const canonicalAddress = (address: string, domainToPrimary: Map<string, string>): string => {
	const at = address.lastIndexOf('@');
	if (at <= 0) {
		return address;
	}
	const primary = domainToPrimary.get(address.slice(at + 1).toLowerCase());
	return primary ? `${address.slice(0, at).toLowerCase()}@${primary}` : address;
};

export interface IdentityAssignment {
	identityKey: string;
	identityEvidence: SeatIdentityEvidence;
}

/** Strength order, so a mailbox reports the best reason it was merged. */
const EVIDENCE_RANK: Record<SeatIdentityEvidence, number> = {
	provider: 3,
	alias_domain: 2,
	admin_link: 1,
	address: 0,
};

/** Directory object ids held by a set of mailboxes, keyed by directory (the merge-root source). */
export type DirectoryObjects = Map<string, Set<string>>;

/** The directory objects a set of mailboxes holds — one identity group, typically. */
export const directoryObjectsOf = (
	members: readonly { providerObjectId: string | null; rootSourceId: string | null }[]
): DirectoryObjects => {
	const byDirectory: DirectoryObjects = new Map();
	for (const member of members) {
		if (!member.providerObjectId || !member.rootSourceId) {
			continue;
		}
		const ids = byDirectory.get(member.rootSourceId) ?? new Set<string>();
		ids.add(member.providerObjectId);
		byDirectory.set(member.rootSourceId, ids);
	}
	return byDirectory;
};

/**
 * Whether joining two groups would put two different objects of one directory together.
 *
 * The single definition of the abuse guard: `computeIdentityGroups` refuses such a union, and the
 * seats controller refuses an administrator link that would need one, so a link is never stored
 * that the grouping would then ignore.
 */
export const directoryObjectsCollide = (
	left: DirectoryObjects,
	right: DirectoryObjects
): boolean => {
	for (const [directory, ids] of right) {
		const existing = left.get(directory);
		if (!existing) {
			continue;
		}
		for (const id of ids) {
			for (const other of existing) {
				if (other !== id) {
					return true;
				}
			}
		}
	}
	return false;
};

/**
 * Groups mailboxes that belong to one person.
 *
 * Edges are added strongest first — what the directory knows, then what the configured domain
 * groups imply, then what an administrator asserted — and a union is refused when it would put
 * two *distinct directory objects from the same directory* in one group. That guard is what keeps
 * the feature trustworthy: a domain group or a hand-made link may merge one person across two tenants
 * or across an import, but it can never merge two colleagues who each have their own account in
 * the same directory, however the group is configured. Provider evidence is exempt, because
 * matching object ids or a directory's own alias list *are* the statement that two addresses are
 * one mailbox.
 */
export const computeIdentityGroups = (
	mailboxes: readonly SeatMailbox[],
	domainToPrimary: Map<string, string>
): Map<string, IdentityAssignment> => {
	const index = new Map<string, number>();
	mailboxes.forEach((mailbox, i) => index.set(mailbox.id, i));

	const parent = mailboxes.map((_, i) => i);
	const find = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};

	// Per set: which directory objects it already contains, keyed by directory.
	const objectsOf = new Map<number, DirectoryObjects>();
	mailboxes.forEach((mailbox, i) => objectsOf.set(i, directoryObjectsOf([mailbox])));

	const bestEvidence = mailboxes.map<SeatIdentityEvidence>(() => 'address');
	const noteEvidence = (i: number, evidence: SeatIdentityEvidence): void => {
		if (EVIDENCE_RANK[evidence] > EVIDENCE_RANK[bestEvidence[i]]) {
			bestEvidence[i] = evidence;
		}
	};

	const wouldCollide = (a: number, b: number): boolean =>
		directoryObjectsCollide(objectsOf.get(a)!, objectsOf.get(b)!);

	const union = (i: number, j: number, evidence: SeatIdentityEvidence): void => {
		const a = find(i);
		const b = find(j);
		if (a === b) {
			noteEvidence(i, evidence);
			noteEvidence(j, evidence);
			return;
		}
		if (evidence !== 'provider' && wouldCollide(a, b)) {
			return;
		}
		parent[b] = a;
		const left = objectsOf.get(a)!;
		for (const [directory, ids] of objectsOf.get(b)!) {
			const existing = left.get(directory);
			if (existing) {
				for (const id of ids) {
					existing.add(id);
				}
			} else {
				left.set(directory, new Set(ids));
			}
		}
		objectsOf.delete(b);
		noteEvidence(i, evidence);
		noteEvidence(j, evidence);
	};

	const eligible = mailboxes
		.map((mailbox, i) => ({ mailbox, i }))
		.filter(({ mailbox }) => !mailbox.isSentinel);

	// 1. Provider evidence: one directory object, or a directory naming the other address.
	const byObject = new Map<string, number[]>();
	const byAddress = new Map<string, number>();
	for (const { mailbox, i } of eligible) {
		byAddress.set(mailbox.address, i);
		if (mailbox.providerObjectId) {
			const key = `${mailbox.provider}:${mailbox.providerObjectId}`;
			byObject.set(key, [...(byObject.get(key) ?? []), i]);
		}
	}
	for (const members of byObject.values()) {
		for (let k = 1; k < members.length; k++) {
			union(members[0], members[k], 'provider');
		}
	}
	for (const { mailbox, i } of eligible) {
		for (const alias of mailbox.providerAliases) {
			const other = byAddress.get(alias);
			if (other !== undefined && other !== i) {
				union(i, other, 'provider');
			}
		}
	}

	// 2. Alias domains: the same local part under two domains of one organization.
	if (domainToPrimary.size > 0) {
		const byCanonical = new Map<string, number[]>();
		for (const { mailbox, i } of eligible) {
			const canonical = canonicalAddress(mailbox.address, domainToPrimary);
			byCanonical.set(canonical, [...(byCanonical.get(canonical) ?? []), i]);
		}
		for (const members of byCanonical.values()) {
			for (let k = 1; k < members.length; k++) {
				union(members[0], members[k], 'alias_domain');
			}
		}
	}

	// 3. Administrator links.
	for (const { mailbox, i } of eligible) {
		if (!mailbox.linkedToMailboxId) {
			continue;
		}
		const other = index.get(mailbox.linkedToMailboxId);
		if (other !== undefined && other !== i && !mailboxes[other].isSentinel) {
			union(i, other, 'admin_link');
		}
	}

	// Name each group. A directory object id is preferred over an address because it survives a
	// rename; the smallest is taken so the key is stable whatever order the rows arrived in.
	const members = new Map<number, number[]>();
	for (const { i } of eligible) {
		const root = find(i);
		members.set(root, [...(members.get(root) ?? []), i]);
	}

	const assignments = new Map<string, IdentityAssignment>();
	for (const mailbox of mailboxes) {
		if (mailbox.isSentinel) {
			assignments.set(mailbox.id, {
				identityKey: mailbox.address,
				identityEvidence: 'address',
			});
		}
	}
	for (const group of members.values()) {
		const objectKeys = group
			.map((i) =>
				mailboxes[i].providerObjectId
					? `${mailboxes[i].provider}:${mailboxes[i].providerObjectId}`
					: null
			)
			.filter((key): key is string => key !== null)
			.sort();
		const identityKey =
			objectKeys[0] ?? `addr:${group.map((i) => mailboxes[i].address).sort()[0]}`;
		for (const i of group) {
			assignments.set(mailboxes[i].id, {
				identityKey,
				identityEvidence: bestEvidence[i],
			});
		}
	}

	return assignments;
};

export interface SeatComputation {
	/** Per mailbox id: the resolved kind and identity to persist. */
	resolved: Map<
		string,
		ResolvedKind & { identityKey: string; identityEvidence: SeatIdentityEvidence }
	>;
	report: SeatReport;
}

/**
 * Resolves every mailbox, groups them, and counts what the license server is told.
 *
 * `excluded` counts mailboxes, not seats: a shared mailbox merged into a person's identity would
 * otherwise be counted twice over. `seats` is the only number that decides billing, and it is
 * deliberately computed from the groups rather than by subtracting exclusions, so an error in the
 * counters can never change what is charged.
 *
 * Every counter except `excluded.inactive` covers the same population as `rawMailboxes`: the
 * mailboxes that hold archived emails. A row the directory listed but which holds nothing costs
 * nothing, so a declaration or exclusion on it reduces nothing either, and counting it would let
 * the exclusion counters exceed `rawMailboxes` — which the license server is told to treat as a
 * malformed report. Those rows are tallied once, in `excluded.inactive`, and nowhere else.
 */
export const computeSeats = (
	mailboxes: readonly SeatMailbox[],
	options: {
		roleLocalParts: Set<string>;
		defaultRoleLocalParts: Set<string>;
		domainGroups: readonly OrganizationDomainGroup[];
		loginUserEmails: Set<string>;
		purposeSignalAvailable: boolean;
		departedBefore: Date;
	}
): SeatComputation => {
	const domainToPrimary = buildDomainToPrimary(options.domainGroups);
	const identities = computeIdentityGroups(mailboxes, domainToPrimary);

	const resolved = new Map<
		string,
		ResolvedKind & { identityKey: string; identityEvidence: SeatIdentityEvidence }
	>();

	const report: SeatReport = {
		seatPolicyVersion: SEAT_POLICY_VERSION,
		computedAt: new Date().toISOString(),
		rawMailboxes: mailboxes.filter((mailbox) => mailbox.active).length,
		seats: 0,
		excluded: {
			provider: 0,
			patternDefault: 0,
			patternAdmin: 0,
			admin: 0,
			sentinel: 0,
			inactive: 0,
		},
		merged: { provider: 0, aliasDomain: 0, adminLink: 0 },
		patternOverridesProvider: 0,
		adminDeclaredSharedCount: 0,
		adminLinks: 0,
		organizationDomainGroups: options.domainGroups.length,
		organizationDomainCount: domainToPrimary.size,
		loginUserOverlap: 0,
		departed: 0,
		purposeSignalAvailable: options.purposeSignalAvailable,
		byProvider: {},
	};

	const groupHasPerson = new Map<string, boolean>();

	for (const mailbox of mailboxes) {
		const kind = resolveKind(
			mailbox,
			options.roleLocalParts,
			isUnlisted(mailbox, options.departedBefore)
		);
		const identity = identities.get(mailbox.id) ?? {
			identityKey: mailbox.address,
			identityEvidence: 'address' as SeatIdentityEvidence,
		};
		resolved.set(mailbox.id, { ...kind, ...identity });

		if (!mailbox.active) {
			report.excluded.inactive++;
			if (!groupHasPerson.has(identity.identityKey)) {
				groupHasPerson.set(identity.identityKey, false);
			}
			continue;
		}

		const perProvider = (report.byProvider[mailbox.provider] ??= { mailboxes: 0, seats: 0 });
		perProvider.mailboxes++;

		if (kind.overrodeProvider) {
			report.patternOverridesProvider++;
		}
		if (mailbox.adminKind === 'shared') {
			report.adminDeclaredSharedCount++;
		}
		if (mailbox.linkedToMailboxId) {
			report.adminLinks++;
		}
		if (identity.identityEvidence === 'provider') {
			report.merged.provider++;
		} else if (identity.identityEvidence === 'alias_domain') {
			report.merged.aliasDomain++;
		} else if (identity.identityEvidence === 'admin_link') {
			report.merged.adminLink++;
		}

		const counts = kindCountsAsPerson(kind.kind);
		if (mailbox.isSentinel) {
			report.excluded.sentinel++;
		} else if (!counts) {
			if (kind.evidence === 'provider') {
				report.excluded.provider++;
			} else if (kind.evidence === 'pattern') {
				if (options.defaultRoleLocalParts.has(localPartOf(mailbox.address))) {
					report.excluded.patternDefault++;
				} else {
					report.excluded.patternAdmin++;
				}
			} else if (kind.evidence === 'admin') {
				report.excluded.admin++;
			}
			// An excluded address that is also somebody's login account is the clearest sign a
			// real person is behind it. Counted, never acted on locally.
			if (options.loginUserEmails.has(mailbox.address)) {
				report.loginUserOverlap++;
			}
		}

		if (isDeparted(mailbox, options.departedBefore)) {
			report.departed++;
		}

		if (!mailbox.isSentinel && counts) {
			groupHasPerson.set(identity.identityKey, true);
		} else if (!groupHasPerson.has(identity.identityKey)) {
			groupHasPerson.set(identity.identityKey, false);
		}
	}

	report.seats = [...groupHasPerson.values()].filter(Boolean).length;

	// Per-provider seats attribute each billable identity to one provider, so the columns add up
	// to the total instead of counting a merged person once per provider they appear under. The
	// provider is taken from a mailbox that actually earns the seat — active and person-owned —
	// not from whichever row of the group happened to sort first.
	const seatProvider = new Map<string, IngestionProvider>();
	for (const mailbox of mailboxes) {
		const identity = resolved.get(mailbox.id);
		if (!identity || !groupHasPerson.get(identity.identityKey)) {
			continue;
		}
		if (
			!seatProvider.has(identity.identityKey) &&
			mailbox.active &&
			!mailbox.isSentinel &&
			kindCountsAsPerson(identity.kind)
		) {
			seatProvider.set(identity.identityKey, mailbox.provider);
		}
	}
	for (const provider of seatProvider.values()) {
		const perProvider = (report.byProvider[provider] ??= { mailboxes: 0, seats: 0 });
		perProvider.seats++;
	}

	return { resolved, report };
};
