/**
 * Indicates the source used to determine the original date of an email.
 * - 'header': parsed from the RFC 5322 `Date:` header (preferred, sender's clock).
 * - 'received': fallback derived from the first `Received:` header (server timestamp).
 * - 'unknown': no usable date could be determined; the consuming code must handle null.
 */
export type OriginalDateSource = 'header' | 'received' | 'unknown';

/**
 * Represents a single email address, including an optional name and the email address itself.
 */
export interface EmailAddress {
	name: string;
	address: string;
}

/**
 * Defines the structure for an email attachment, including its filename, content type, size, and the raw content as a buffer.
 */
export interface EmailAttachment {
	filename: string;
	contentType: string;
	size: number;
	content: Buffer;
}

/**
 * Describes the universal structure for a raw email object, designed to be compatible with various ingestion sources like IMAP and Google Workspace.
 * This type serves as a standardized representation of an email before it is processed and stored in the database.
 */
export interface EmailObject {
	/** A unique identifier for the email, typically assigned by the source provider. */
	id: string;
	/** An optional identifier for the email thread, used to group related emails. */
	threadId?: string;
	/** An array of `EmailAddress` objects representing the sender(s). */
	from: EmailAddress[];
	/** An array of `EmailAddress` objects representing the primary recipient(s). */
	to: EmailAddress[];
	/** An optional array of `EmailAddress` objects for carbon copy (CC) recipients. */
	cc?: EmailAddress[];
	/** An optional array of `EmailAddress` objects for blind carbon copy (BCC) recipients. */
	bcc?: EmailAddress[];
	/** The subject line of the email. */
	subject: string;
	/** The plain text body of the email. */
	body: string;
	/** The HTML version of the email body, if available. */
	html: string;
	/** A map of all email headers, where keys are header names and values can be a string, an array of strings, or a complex object. */
	headers: Map<string, any>;
	/** An array of `EmailAttachment` objects found in the email. */
	attachments: EmailAttachment[];
	/** The date and time when the email was received. Null if the original Date header was missing or unparseable. */
	receivedAt: Date | null;
	/** Indicates where `receivedAt` was sourced from (Date header, Received header, or unknown). */
	receivedAtSource?: OriginalDateSource;
	/** Path to a temporary file on disk containing the raw EML bytes.
	 * Connectors write the raw email to tmpdir() and pass only the path,
	 * keeping large buffers off the JS heap between yield and processEmail(). */
	tempFilePath: string;
	/** The email address of the user whose mailbox this email belongs to. */
	userEmail?: string;
	/** The folder path of the email in the source mailbox. */
	path?: string;
	/** An array of tags or labels associated with the email. */
	tags?: string[];
}

/**
 * Represents an email that has been processed and is ready for indexing.
 * Represents an email that has been processed and is ready for indexing.
 * This interface defines the shape of the data that is passed to the batch indexing function.
 */
export interface PendingEmail {
	/** The unique identifier of the archived email record in the database.
	 * This ID is used to retrieve the full email data from the database and storage for indexing.
	 */
	archivedEmailId: string;
}

// Define the structure of the document to be indexed in Meilisearch
export interface EmailDocument {
	id: string; // The unique ID of the email
	userEmail: string;
	from: string;
	to: string[];
	cc: string[];
	bcc: string[];
	subject: string;
	body: string;
	attachments: {
		filename: string;
		content: string; // Extracted text from the attachment
		/** SHA-256 hex digest of the attachment bytes. Optional because
		 * pre-P3 documents in existing indexes do not carry it; reindex via
		 * the orchestrator backfills it. */
		sha256?: string;
	}[];
	/** Unix epoch (ms) of the email's original date. Omitted when the date is unknown. */
	timestamp?: number;
	ingestionSourceId: string;
	// --- P3 additions ---
	// Required-on-new-docs scalars stay required so freshly indexed documents
	// always carry them; the orchestrator backfills existing rows.
	// Strings/arrays that are genuinely nullable in the DB stay optional and
	// are omitted (not null) when unknown.
	/** Folder / mailbox path in the source system (e.g. 'INBOX/Projects'). */
	path?: string;
	/** Free-form labels carried over from the source (Gmail labels, IMAP keywords, etc.). */
	tags?: string[];
	/** True iff the archived row has linked attachments. */
	hasAttachments: boolean;
	/** Size of the stored .eml in bytes. */
	sizeBytes: number;
	/** True iff the archived row is on legal hold. */
	isOnLegalHold: boolean;
	/** Provider thread identifier when available. */
	threadId?: string;
	// other metadata
}
