import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmailObject, IngestionSource } from '@open-archiver/types';

const { readFileMock, unlinkMock, findFirstMock, insertMock, selectMock } = vi.hoisted(() => ({
	readFileMock: vi.fn(),
	unlinkMock: vi.fn().mockResolvedValue(undefined),
	findFirstMock: vi.fn(),
	insertMock: vi.fn(),
	selectMock: vi.fn(),
}));

vi.mock('fs/promises', () => ({
	readFile: readFileMock,
	unlink: unlinkMock,
}));

vi.mock('../database', () => ({
	db: {
		query: {
			archivedEmails: {
				findFirst: findFirstMock,
			},
			attachments: {
				findFirst: vi.fn(),
			},
		},
		insert: insertMock,
		select: selectMock,
	},
}));

vi.mock('../config/index', () => ({
	config: {
		storage: { openArchiverFolderName: 'open-archiver' },
		app: { encryptionKey: 'test-encryption-key-for-unit-tests' },
	},
}));

vi.mock('../helpers/emlUtils', () => ({
	stripAttachmentsFromEml: vi.fn((buffer: Buffer) => buffer),
}));

vi.mock('../jobs/queues', () => ({
	ingestionQueue: { add: vi.fn() },
	indexingQueue: { add: vi.fn() },
}));

import { IngestionService } from '../services/IngestionService';
import { StorageService } from '../services/StorageService';

const sourceId = '11111111-1111-1111-1111-111111111111';
const userEmail = 'user@example.com';

const baseSource: IngestionSource = {
	id: sourceId,
	name: 'Test Source',
	provider: 'google_workspace',
	status: 'active',
	createdAt: new Date(),
	updatedAt: new Date(),
	credentials: {} as IngestionSource['credentials'],
	preserveOriginalFile: false,
};

function makeEmail(overrides: Partial<EmailObject> = {}): EmailObject {
	const headers = overrides.headers ?? new Map<string, string>();
	if (!headers.has('message-id') && !('headers' in overrides)) {
		headers.set('message-id', '<shared@example.com>');
	}

	return {
		id: 'gmail-msg-1',
		from: [{ name: 'Sender', address: 'sender@example.com' }],
		to: [{ name: 'Recipient', address: 'recipient@example.com' }],
		subject: 'Test Subject',
		body: 'plain body',
		html: '',
		headers,
		attachments: [],
		receivedAt: new Date('2024-06-01T10:00:00Z'),
		tempFilePath: '/tmp/test-email.eml',
		...overrides,
	};
}

function mockInsertReturning(row: Record<string, unknown>) {
	insertMock.mockReturnValue({
		values: vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([row]),
			onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
		}),
	});
}

describe('IngestionService.processEmail gate deduplication', () => {
	let storagePut: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		readFileMock.mockResolvedValue(Buffer.from('raw eml content'));
		findFirstMock.mockResolvedValue(undefined);
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([]),
			}),
		});
		vi.spyOn(IngestionService, 'findGroupSourceIds').mockResolvedValue([sourceId]);
		storagePut = vi.fn().mockResolvedValue(undefined);
	});

	it('does not call readFile on Gate 1 duplicate', async () => {
		findFirstMock.mockResolvedValueOnce({ id: 'existing-mailbox-row' });

		const service = new IngestionService();
		const result = await service.processEmail(
			makeEmail(),
			baseSource,
			{ put: storagePut } as unknown as StorageService,
			userEmail
		);

		expect(result).toBeNull();
		expect(readFileMock).not.toHaveBeenCalled();
	});

	it('does not call readFile on Gate 2 shared-file reference path', async () => {
		findFirstMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			id: 'existing-group-row',
			storagePath: 'open-archiver/source/emails/msg.eml',
			storageHashSha256: 'abc123',
			sizeBytes: 100,
			hasAttachments: false,
		});

		mockInsertReturning({ id: 'reference-row-id' });

		const service = new IngestionService();
		const result = await service.processEmail(
			makeEmail({ tempFilePath: undefined }),
			baseSource,
			{ put: storagePut } as unknown as StorageService,
			userEmail
		);

		expect(result).toEqual({ archivedEmailId: 'reference-row-id' });
		expect(readFileMock).not.toHaveBeenCalled();
		expect(insertMock).toHaveBeenCalled();
	});

	it('calls readFile on Gate 3 new ingestion', async () => {
		mockInsertReturning({ id: 'new-archived-row' });

		const service = new IngestionService();
		const result = await service.processEmail(
			makeEmail(),
			baseSource,
			{ put: storagePut } as unknown as StorageService,
			userEmail
		);

		expect(result).toEqual({ archivedEmailId: 'new-archived-row' });
		expect(readFileMock).toHaveBeenCalledWith('/tmp/test-email.eml');
		expect(storagePut).toHaveBeenCalled();
	});

	it('calls readFile when Message-ID header is missing (hash fallback)', async () => {
		const headers = new Map<string, string>();
		mockInsertReturning({ id: 'hash-fallback-row' });

		const service = new IngestionService();
		const result = await service.processEmail(
			makeEmail({ headers }),
			baseSource,
			{ put: storagePut } as unknown as StorageService,
			userEmail
		);

		expect(result).toEqual({ archivedEmailId: 'hash-fallback-row' });
		expect(readFileMock).toHaveBeenCalledWith('/tmp/test-email.eml');
	});

	it('trims Message-ID before Gate 2 lookup', async () => {
		findFirstMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			id: 'existing-group-row',
			storagePath: 'open-archiver/source/emails/msg.eml',
			storageHashSha256: 'abc123',
			sizeBytes: 100,
			hasAttachments: false,
		});
		mockInsertReturning({ id: 'trimmed-ref-row' });

		const headers = new Map([['message-id', '  <shared@example.com>  ']]);
		const service = new IngestionService();
		const result = await service.processEmail(
			makeEmail({ headers, tempFilePath: undefined }),
			baseSource,
			{ put: storagePut } as unknown as StorageService,
			userEmail
		);

		expect(result).toEqual({ archivedEmailId: 'trimmed-ref-row' });
		expect(readFileMock).not.toHaveBeenCalled();
	});

	it('updates knownMessageIds after Gate 2 reference insert', async () => {
		findFirstMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			id: 'existing-group-row',
			storagePath: 'open-archiver/source/emails/msg.eml',
			storageHashSha256: 'abc123',
			sizeBytes: 100,
			hasAttachments: false,
		});
		mockInsertReturning({ id: 'reference-row-id' });

		const knownMessageIds = new Set<string>();
		const service = new IngestionService();
		await service.processEmail(
			makeEmail({ tempFilePath: undefined }),
			baseSource,
			{ put: storagePut } as unknown as StorageService,
			userEmail,
			false,
			[sourceId],
			knownMessageIds
		);

		expect(knownMessageIds.has('<shared@example.com>')).toBe(true);
		expect(knownMessageIds.has('gmail-msg-1')).toBe(true);
	});

	it('updates knownMessageIds after Gate 3 new ingestion', async () => {
		mockInsertReturning({ id: 'new-archived-row' });

		const knownMessageIds = new Set<string>();
		const service = new IngestionService();
		await service.processEmail(
			makeEmail(),
			baseSource,
			{ put: storagePut } as unknown as StorageService,
			userEmail,
			false,
			[sourceId],
			knownMessageIds
		);

		expect(knownMessageIds.has('<shared@example.com>')).toBe(true);
		expect(knownMessageIds.has('gmail-msg-1')).toBe(true);
	});
});

describe('IngestionService.preloadExistingMessageIds (integration with gate2 mocks)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('loads IDs via select query for merge group', async () => {
		vi.spyOn(IngestionService, 'findGroupSourceIds').mockResolvedValue([sourceId]);
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([
					{
						messageIdHeader: '<shared@example.com>',
						providerMessageId: 'gmail-msg-existing',
					},
				]),
			}),
		});

		const result = await IngestionService.preloadExistingMessageIds(sourceId);

		expect(result.knownMessageIds.has('<shared@example.com>')).toBe(true);
		expect(result.knownMessageIds.has('gmail-msg-existing')).toBe(true);
		expect(result.groupSourceIds).toEqual([sourceId]);
	});
});
