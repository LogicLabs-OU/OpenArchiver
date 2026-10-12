import type {
	MailboxKind,
	MailboxKindEvidence,
	SeatIdentityEvidence,
	SeatPolicy,
	SeatReport,
} from '@open-archiver/types';

/** One row of the mailbox registry, as the seats API returns it. */
export interface SeatMailboxRow {
	id: string;
	address: string;
	displayName: string | null;
	provider: string;
	rootSourceId: string | null;
	providerObjectId: string | null;
	providerKind: MailboxKind | null;
	licensed: boolean | null;
	accountEnabled: boolean | null;
	hasMailbox: boolean | null;
	active: boolean;
	emailCount: number;
	isSentinel: boolean;
	adminKind: MailboxKind | null;
	adminDeclaredReason: string | null;
	linkedToMailboxId: string | null;
	kind: MailboxKind;
	kindEvidence: MailboxKindEvidence;
	identityKey: string;
	identityEvidence: SeatIdentityEvidence;
	identityGroupSize: number;
	lastListedAt: string | null;
}

export interface SeatReportResponse {
	report: SeatReport | null;
	policy: SeatPolicy;
	defaultRoleLocalParts: string[];
	/** True when the report shown is stale and a recount is running behind it. */
	reconciling: boolean;
}
