/** Status of a journaling source's SMTP listener */
export type JournalingSourceStatus = 'active' | 'paused';

/**
 * A domain group mapping a primary (canonical) domain to zero or more alias domains.
 * When resolving the mailbox owner of a journaled email, any address whose domain
 * matches `main` or any entry in `aliases` is normalized to `<local-part>@main`.
 *
 * Example: { main: "abc.com", aliases: ["xyz.com", "qwer.com"] }
 *   user1@xyz.com  → user1@abc.com
 *   user1@abc.com  → user1@abc.com  (already canonical)
 */
export interface OrganizationDomainGroup {
	main: string;
	aliases: string[];
}

/** Represents a configured journaling source */
export interface JournalingSource {
	id: string;
	name: string;
	/** CIDR blocks or IP addresses allowed to send journal reports */
	allowedIps: string[];
	/** Organization domain groups. Each entry maps a primary domain to its aliases.
	 *  Used to identify and normalize the mailbox owner of journaled emails. */
	organizationDomains: OrganizationDomainGroup[];
	/** Whether to reject plain-text (non-TLS) connections */
	requireTls: boolean;
	/** Optional SMTP AUTH username for the journal endpoint */
	smtpUsername: string | null;
	/** Whether SMTP AUTH credentials are currently configured (password hash is stored).
	 *  The actual password is never returned by the API — use this flag in the UI
	 *  to show contextual hints when editing. */
	hasSmtpAuth: boolean;
	status: JournalingSourceStatus;
	/** The backing ingestion source ID that owns archived emails */
	ingestionSourceId: string;
	/**
	 * The SMTP routing address the admin must configure in their MTA
	 * (e.g. journal-abc12345@archive.yourdomain.com).
	 * Computed server-side from the source ID and SMTP_JOURNALING_DOMAIN.
	 */
	routingAddress: string;
	/** Total number of emails received via this journaling source */
	totalReceived: number;
	/** Timestamp of the last email received */
	lastReceivedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

/** DTO for creating a new journaling source */
export interface CreateJournalingSourceDto {
	name: string;
	allowedIps: string[];
	/** Organization domain groups for mailbox owner resolution and domain normalization. */
	organizationDomains?: OrganizationDomainGroup[];
	requireTls?: boolean;
	smtpUsername?: string;
	smtpPassword?: string;
	/** Store the unmodified raw EML for GoBD compliance. Defaults to true for journaling. */
	preserveOriginalFile?: boolean;
	/** Merge the backing ingestion source into an existing root source's group. */
	mergedIntoId?: string;
}

/** DTO for updating an existing journaling source */
export interface UpdateJournalingSourceDto {
	name?: string;
	allowedIps?: string[];
	/** Organization domain groups for mailbox owner resolution and domain normalization. */
	organizationDomains?: OrganizationDomainGroup[];
	requireTls?: boolean;
	status?: JournalingSourceStatus;
	smtpUsername?: string;
	smtpPassword?: string;
}

/** Job data for the journal-inbound BullMQ job */
export interface IJournalInboundJob {
	/** The journaling source ID that received the email */
	journalingSourceId: string;
	/**
	 * Path to the temp file containing the raw email data on the local filesystem.
	 * Raw emails are written to disk instead of embedded in the Redis job payload
	 * to avoid Redis memory pressure (base64 inflates 50MB → ~67MB per job).
	 * The worker is responsible for deleting this file after processing.
	 */
	tempFilePath: string;
	/** IP address of the sending MTA */
	remoteAddress: string;
	/** Timestamp when the SMTP listener received the email */
	receivedAt: string;
}
