/** Status of a journaling source's SMTP listener */
export type JournalingSourceStatus = 'active' | 'paused';

/** Represents a configured journaling source */
export interface JournalingSource {
	id: string;
	name: string;
	/** CIDR blocks or IP addresses allowed to send journal reports */
	allowedIps: string[];
	/** Whether to reject plain-text (non-TLS) connections */
	requireTls: boolean;
	/** Optional SMTP AUTH username for the journal endpoint */
	smtpUsername: string | null;
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
	requireTls?: boolean;
	smtpUsername?: string;
	smtpPassword?: string;
}

/** DTO for updating an existing journaling source */
export interface UpdateJournalingSourceDto {
	name?: string;
	allowedIps?: string[];
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
