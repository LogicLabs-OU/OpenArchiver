import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst, mockInsert, mockUnlink } = vi.hoisted(() => ({
	mockFindFirst: vi.fn(),
	mockInsert: vi.fn(),
	mockUnlink: vi.fn(),
}));

vi.mock('../config', () => ({
	config: {
		storage: { openArchiverFolderName: 'open-archiver' },
		meili: { indexingBatchSize: 100 },
	},
}));

vi.mock('../config/logger', () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../config/storage', () => ({}));

vi.mock('../services/CryptoService', () => ({
	CryptoService: {
		encryptObject: vi.fn((obj: any) => JSON.stringify(obj)),
		decryptObject: vi.fn((str: string) => JSON.parse(str)),
	},
}));

vi.mock('../services/SearchService', () => ({
	SearchService: vi.fn().mockImplementation(function () {
		return { deleteDocumentsByFilter: vi.fn() };
	}),
}));

vi.mock('../services/AuditService', () => ({
	AuditService: vi.fn().mockImplementation(function () {
		return { createAuditLog: vi.fn() };
	}),
}));

vi.mock('../helpers/deletionGuard', () => ({
	checkDeletionEnabled: vi.fn(),
}));

vi.mock('../jobs/queues', () => ({
	ingestionQueue: { add: vi.fn(), getJobs: vi.fn().mockResolvedValue([]) },
	indexingQueue: { add: vi.fn() },
}));

vi.mock('drizzle-orm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('drizzle-orm')>();
	return {
		...actual,
		eq: vi.fn((_col: any, val: any) => val),
		inArray: vi.fn((_col: any, vals: any[]) => vals),
		and: vi.fn((...args: any[]) => args),
		or: vi.fn((...args: any[]) => args),
		desc: vi.fn(),
	};
});

vi.mock('fs/promises', () => ({
	readFile: vi.fn().mockResolvedValue(Buffer.from('raw-eml-content')),
	unlink: (...args: any[]) => mockUnlink(...args),
}));

vi.mock('../helpers/emlUtils', () => ({
	stripAttachmentsFromEml: vi.fn((buf: any) => Promise.resolve(buf)),
}));

vi.mock('crypto', () => ({
	createHash: vi.fn(() => ({
		update: vi.fn().mockReturnThis(),
		digest: vi.fn().mockReturnValue('fakehash1234567890'),
	})),
	randomUUID: vi.fn().mockReturnValue('aaa-bbb-ccc'),
}));

vi.mock('../database', () => ({
	db: {
		query: {
			archivedEmails: {
				findFirst: (...args: any[]) => mockFindFirst(...args),
			},
			attachments: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
		},
		insert: (...args: any[]) => mockInsert(...args),
	},
}));

vi.mock('../database/schema', () => ({
	archivedEmails: {
		ingestionSourceId: 'ingestionSourceId',
		messageIdHeader: 'messageIdHeader',
		providerMessageId: 'providerMessageId',
		storageHashSha256: 'storageHashSha256',
		threadId: 'threadId',
		userEmail: 'userEmail',
		sentAt: 'sentAt',
		subject: 'subject',
		senderName: 'senderName',
		senderEmail: 'senderEmail',
		recipients: 'recipients',
		storagePath: 'storagePath',
		sizeBytes: 'sizeBytes',
		hasAttachments: 'hasAttachments',
		path: 'path',
		tags: 'tags',
	},
	attachments: {
		contentHashSha256: 'contentHashSha256',
		ingestionSourceId: 'ingestionSourceId',
		filename: 'filename',
		mimeType: 'mimeType',
		sizeBytes: 'sizeBytes',
		storagePath: 'storagePath',
	},
	emailAttachments: {
		emailId: 'emailId',
		attachmentId: 'attachmentId',
	},
	ingestionSources: {
		id: 'id',
		mergedIntoId: 'mergedIntoId',
	},
}));

vi.mock('../services/StorageService', () => ({
	StorageService: vi.fn().mockImplementation(function () {
		return {
			put: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(false),
		};
	}),
}));

import { IngestionService } from '../services/IngestionService';
import { StorageService } from '../services/StorageService';

function makeEmail(overrides: Record<string, any> = {}) {
	return {
		id: '<test@mail.com>',
		threadId: 'thread-1',
		from: [{ name: 'Sender', address: 'sender@mail.com' }],
		to: [{ name: 'Recipient', address: 'recipient@mail.com' }],
		cc: [],
		bcc: [],
		subject: 'Test Subject',
		body: 'body',
		html: '<p>body</p>',
		headers: new Map([['message-id', '<test@mail.com>']]),
		attachments: [],
		receivedAt: new Date('2024-01-01'),
		tempFilePath: '/tmp/test-email.eml',
		path: 'INBOX',
		...overrides,
	};
}

function makeSource(overrides: Record<string, any> = {}) {
	return {
		id: 'source-1',
		name: 'Test Source',
		provider: 'generic_imap',
		status: 'active',
		credentials: { type: 'generic_imap' },
		syncState: null,
		mergedIntoId: null,
		preserveOriginalFile: false,
		userId: 'user-1',
		...overrides,
	};
}

describe('IngestionService.processEmail — cached params (Changes 2 & 3)', () => {
	let service: IngestionService;
	let storage: StorageService;

	beforeEach(() => {
		vi.clearAllMocks();
		service = new IngestionService();
		storage = new StorageService();
		mockUnlink.mockResolvedValue(undefined);
		mockFindFirst.mockResolvedValue(null);
		mockInsert.mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([{ id: 'email-uuid-1' }]),
			}),
		});
	});

	it('skips DB duplicate check when messageId is in knownMessageIds Set', async () => {
		const knownMessageIds = new Set(['<test@mail.com>']);

		const result = await service.processEmail(
			makeEmail(),
			makeSource(),
			storage,
			'user@mail.com',
			['source-1'],
			knownMessageIds
		);

		expect(result).toBeNull();
		expect(mockFindFirst).not.toHaveBeenCalled();
		expect(mockInsert).not.toHaveBeenCalled();
	});

	it('adds messageId to knownMessageIds Set after successful insert (default mode)', async () => {
		const knownMessageIds = new Set<string>();

		const result = await service.processEmail(
			makeEmail(),
			makeSource(),
			storage,
			'user@mail.com',
			['source-1'],
			knownMessageIds
		);

		expect(result).toEqual({ archivedEmailId: 'email-uuid-1' });
		expect(knownMessageIds.has('<test@mail.com>')).toBe(true);
	});

	it('adds messageId to knownMessageIds after successful insert (preserveOriginalFile mode)', async () => {
		const knownMessageIds = new Set<string>();

		const result = await service.processEmail(
			makeEmail(),
			makeSource({ preserveOriginalFile: true }),
			storage,
			'user@mail.com',
			['source-1'],
			knownMessageIds
		);

		expect(result).toEqual({ archivedEmailId: 'email-uuid-1' });
		expect(knownMessageIds.has('<test@mail.com>')).toBe(true);
	});

	it('prevents in-run duplicate when same messageId is processed twice', async () => {
		const knownMessageIds = new Set<string>();

		const result1 = await service.processEmail(
			makeEmail(),
			makeSource(),
			storage,
			'user@mail.com',
			['source-1'],
			knownMessageIds
		);

		expect(result1).toEqual({ archivedEmailId: 'email-uuid-1' });
		expect(knownMessageIds.has('<test@mail.com>')).toBe(true);

		const result2 = await service.processEmail(
			makeEmail(),
			makeSource(),
			storage,
			'user@mail.com',
			['source-1'],
			knownMessageIds
		);

		expect(result2).toBeNull();
	});

	it('falls back to DB check when knownMessageIds is not provided', async () => {
		const findGroupSpy = vi
			.spyOn(IngestionService, 'findGroupSourceIds')
			.mockResolvedValue(['source-1']);
		mockFindFirst.mockResolvedValue({ id: 'existing-email-id' });

		const result = await service.processEmail(
			makeEmail(),
			makeSource(),
			storage,
			'user@mail.com'
		);

		expect(result).toBeNull();
		expect(mockFindFirst).toHaveBeenCalled();
		findGroupSpy.mockRestore();
	});

	it('uses cached groupSourceIds instead of calling findGroupSourceIds', async () => {
		const findGroupSpy = vi
			.spyOn(IngestionService, 'findGroupSourceIds')
			.mockResolvedValue(['source-1']);

		await service.processEmail(
			makeEmail(),
			makeSource(),
			storage,
			'user@mail.com',
			['source-1'],
			new Set()
		);

		expect(findGroupSpy).not.toHaveBeenCalled();
		findGroupSpy.mockRestore();
	});

	it('calls findGroupSourceIds when groupSourceIds is not provided', async () => {
		const findGroupSpy = vi
			.spyOn(IngestionService, 'findGroupSourceIds')
			.mockResolvedValue(['source-1']);

		await service.processEmail(
			makeEmail(),
			makeSource(),
			storage,
			'user@mail.com'
		);

		expect(findGroupSpy).toHaveBeenCalledWith('source-1');
		findGroupSpy.mockRestore();
	});

	it('cleans up temp file even when email is a cached duplicate', async () => {
		const knownMessageIds = new Set(['<test@mail.com>']);

		await service.processEmail(
			makeEmail(),
			makeSource(),
			storage,
			'user@mail.com',
			['source-1'],
			knownMessageIds
		);

		expect(mockUnlink).toHaveBeenCalledWith('/tmp/test-email.eml');
	});
});
