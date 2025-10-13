/**
 * Represents a single recipient of an email.
 */
export interface Recipient {
	name?: string;
	email: string;
}

/**
 * Represents a single attachment of an email.
 */
export interface Attachment {
	id: string;
	filename: string;
	mimeType: string | null;
	sizeBytes: number;
	storagePath: string;
}

export interface ThreadEmail {
	id: string; //the archivedemail id
	subject: string | null;
	sentAt: Date;
	senderEmail: string;
}

/**
 * Represents a single archived email.
 */
export interface ArchivedEmail {
	id: string;
	ingestionSourceId: string;
	userEmail: string;
	messageIdHeader: string | null;
	sentAt: Date;
	subject: string | null;
	senderName: string | null;
	senderEmail: string;
	recipients: Recipient[];
	storagePath: string;
	storageHashSha256: string;
	sizeBytes: number;
	isIndexed: boolean;
	hasAttachments: boolean;
	isOnLegalHold: boolean;
	archivedAt: Date;
	attachments?: Attachment[];
	raw?: Buffer;
	thread?: ThreadEmail[];
	path: string | null;
	tags: string[] | null;
}

/**
 * Represents a paginated list of archived emails.
 */
export interface PaginatedArchivedEmails {
	items: ArchivedEmail[];
	total: number;
	page: number;
	limit: number;
}

/**
 * Query parameters for filtering and sorting archived emails
 */
export interface ArchivedEmailsQuery {
	ingestionSourceId: string;
	page: number;
	limit: number;
	path?: string | null;
	sortBy?: 'sentAt' | 'senderEmail' | 'subject';
	sortOrder?: 'asc' | 'desc';
}

/**
 * Represents a folder in the email hierarchy
 */
export interface EmailFolder {
	path: string;
	name: string;
	count: number;
	children: EmailFolder[];
}
