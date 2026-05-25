/**
 * Unit tests for IndexingService.createEmailDocument.
 *
 * We exercise the method via its public path `indexEmailById` by stubbing the
 * DB query layer, storage stream, and the attachments select. The goal is to
 * pin the EmailDocument shape — every P3 field is asserted explicitly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

// Stub the text extractor before importing the service so the module-level
// import in IndexingService picks up the mock.
vi.mock('../helpers/textExtractor', () => ({
	extractText: vi.fn(async () => 'extracted text'),
}));

vi.mock('mailparser', () => ({
	simpleParser: vi.fn(async () => ({
		text: 'parsed body text',
		html: '<p>parsed</p>',
		attachments: [],
	})),
}));

import { IndexingService } from './IndexingService';
import type { EmailDocument } from '@open-archiver/types';

type ArchivedEmailRow = {
	id: string;
	threadId: string | null;
	ingestionSourceId: string;
	userEmail: string;
	messageIdHeader: string | null;
	providerMessageId: string | null;
	sentAt: Date | null;
	subject: string | null;
	senderName: string | null;
	senderEmail: string;
	recipients: unknown;
	storagePath: string;
	storageHashSha256: string;
	sizeBytes: number;
	isIndexed: boolean;
	hasAttachments: boolean;
	isOnLegalHold: boolean;
	isJournaled: boolean | null;
	archivedAt: Date;
	originalDateSource: string;
	dateBackfilledAt: Date | null;
	path: string | null;
	tags: unknown;
};

const sampleRow = (overrides: Partial<ArchivedEmailRow> = {}): ArchivedEmailRow => ({
	id: 'email-1',
	threadId: 'thread-xyz',
	ingestionSourceId: 'source-1',
	userEmail: 'user@example.com',
	messageIdHeader: '<msg-1@example.com>',
	providerMessageId: 'p1',
	sentAt: new Date('2025-01-15T10:00:00Z'),
	subject: 'Hello',
	senderName: 'Alice',
	senderEmail: 'alice@example.com',
	recipients: { to: [{ name: 'Bob', address: 'bob@example.com' }], cc: [], bcc: [] },
	storagePath: '/storage/emails/email-1.eml',
	storageHashSha256: 'storagehash',
	sizeBytes: 12345,
	isIndexed: false,
	hasAttachments: true,
	isOnLegalHold: false,
	isJournaled: false,
	archivedAt: new Date('2025-01-15T10:05:00Z'),
	originalDateSource: 'header',
	dateBackfilledAt: null,
	path: 'INBOX/Projects',
	tags: ['important', 'q1'],
	...overrides,
});

const makeService = (row: ArchivedEmailRow) => {
	const dbService: any = {
		db: {
			query: {
				archivedEmails: {
					findFirst: vi.fn(async () => row),
				},
			},
			select: vi.fn(() => ({
				from: () => ({
					innerJoin: () => ({
						where: async () => [],
					}),
				}),
			})),
		},
	};
	const searchService: any = {
		addDocuments: vi.fn(async () => ({ taskUid: 1 })),
		getIndex: vi.fn(async () => ({})),
	};
	const storageService: any = {
		get: vi.fn(async () => Readable.from(Buffer.from('raw eml bytes'))),
	};
	const svc = new IndexingService(dbService, searchService, storageService);
	return { svc, dbService, searchService, storageService };
};

const runIndex = async (row: ArchivedEmailRow): Promise<EmailDocument> => {
	const { svc, searchService } = makeService(row);
	await svc.indexEmailBatch([{ archivedEmailId: row.id }]);
	const addDocs = searchService.addDocuments as ReturnType<typeof vi.fn>;
	expect(addDocs).toHaveBeenCalledTimes(1);
	const [, docs] = addDocs.mock.calls[0];
	return (docs as EmailDocument[])[0];
};

describe('IndexingService.createEmailDocument (P3 shape)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('emits the full P3 field set from a populated row', async () => {
		const doc = await runIndex(sampleRow());

		expect(doc.id).toBe('email-1');
		expect(doc.userEmail).toBe('user@example.com');
		expect(doc.from).toBe('alice@example.com');
		expect(doc.to).toEqual(['bob@example.com']);
		expect(doc.subject).toBe('Hello');
		expect(doc.ingestionSourceId).toBe('source-1');

		// P3 fields
		expect(doc.path).toBe('INBOX/Projects');
		expect(doc.tags).toEqual(['important', 'q1']);
		expect(doc.hasAttachments).toBe(true);
		expect(doc.sizeBytes).toBe(12345);
		expect(doc.isOnLegalHold).toBe(false);
		expect(doc.threadId).toBe('thread-xyz');
	});

	it('coerces null path to undefined (not the string "null")', async () => {
		const doc = await runIndex(sampleRow({ path: null }));
		expect(doc.path).toBeUndefined();
		// JSON round-trip must not introduce the literal string "null".
		expect(JSON.stringify(doc)).not.toContain('"path":"null"');
	});

	it('coerces null tags to undefined', async () => {
		const doc = await runIndex(sampleRow({ tags: null }));
		expect(doc.tags).toBeUndefined();
	});

	it('filters non-string entries out of tags', async () => {
		const doc = await runIndex(
			sampleRow({ tags: ['ok', 42, null, 'fine'] as unknown as string[] })
		);
		expect(doc.tags).toEqual(['ok', 'fine']);
	});

	it('coerces null threadId to undefined', async () => {
		const doc = await runIndex(sampleRow({ threadId: null }));
		expect(doc.threadId).toBeUndefined();
	});

	it('preserves boolean flags exactly (no string coercion)', async () => {
		const doc = await runIndex(
			sampleRow({ hasAttachments: false, isOnLegalHold: true })
		);
		expect(doc.hasAttachments).toBe(false);
		expect(doc.isOnLegalHold).toBe(true);
	});
});
