import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDbSelect } = vi.hoisted(() => ({
	mockDbSelect: vi.fn(),
}));

vi.mock('../config', () => ({
	config: {},
}));

vi.mock('../config/logger', () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../config/storage', () => ({}));

vi.mock('../services/CryptoService', () => ({
	CryptoService: {
		encryptObject: vi.fn((obj: unknown) => JSON.stringify(obj)),
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
		eq: vi.fn((_col: unknown, val: unknown) => val),
		inArray: vi.fn((_col: unknown, vals: unknown[]) => vals),
		and: vi.fn((...args: unknown[]) => args),
		or: vi.fn((...args: unknown[]) => args),
		desc: vi.fn(),
	};
});

vi.mock('../database', () => ({
	db: {
		select: (...args: unknown[]) => mockDbSelect(...args),
		query: {
			archivedEmails: {
				findFirst: vi.fn(),
			},
		},
	},
}));

vi.mock('../database/schema', () => ({
	archivedEmails: {
		ingestionSourceId: 'ingestionSourceId',
		messageIdHeader: 'messageIdHeader',
		providerMessageId: 'providerMessageId',
	},
	ingestionSources: {
		id: 'id',
		mergedIntoId: 'mergedIntoId',
	},
}));

import { IngestionService } from '../services/IngestionService';

function setupSelectMock(rows: unknown[]) {
	mockDbSelect.mockReturnValue({
		from: () => ({
			where: () => Promise.resolve(rows),
		}),
	});
}

describe('IngestionService.preloadExistingMessageIds', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a Set with all known messageIdHeaders and providerMessageIds', async () => {
		vi.spyOn(IngestionService, 'findGroupSourceIds').mockResolvedValue(['source-1']);
		setupSelectMock([
			{ messageIdHeader: '<msg1@mail.com>', providerMessageId: 'imap-uid-100' },
			{ messageIdHeader: '<msg2@mail.com>', providerMessageId: null },
			{ messageIdHeader: null, providerMessageId: 'imap-uid-200' },
		]);

		const result = await IngestionService.preloadExistingMessageIds('source-1');

		expect(result.knownMessageIds).toBeInstanceOf(Set);
		expect(result.knownMessageIds.has('<msg1@mail.com>')).toBe(true);
		expect(result.knownMessageIds.has('<msg2@mail.com>')).toBe(true);
		expect(result.knownMessageIds.has('imap-uid-100')).toBe(true);
		expect(result.knownMessageIds.has('imap-uid-200')).toBe(true);
		expect(result.knownMessageIds.size).toBe(4);
		expect(result.groupSourceIds).toEqual(['source-1']);
	});

	it('returns empty Set when no emails exist', async () => {
		vi.spyOn(IngestionService, 'findGroupSourceIds').mockResolvedValue(['source-1']);
		setupSelectMock([]);

		const result = await IngestionService.preloadExistingMessageIds('source-1');

		expect(result.knownMessageIds.size).toBe(0);
	});

	it('includes all group source IDs when source is part of a merge group', async () => {
		vi.spyOn(IngestionService, 'findGroupSourceIds').mockResolvedValue([
			'source-root',
			'source-child',
		]);
		setupSelectMock([
			{ messageIdHeader: '<merged@mail.com>', providerMessageId: 'uid-1' },
		]);

		const result = await IngestionService.preloadExistingMessageIds('source-child');

		expect(result.groupSourceIds).toEqual(['source-root', 'source-child']);
		expect(result.knownMessageIds.has('<merged@mail.com>')).toBe(true);
		expect(result.knownMessageIds.has('uid-1')).toBe(true);
	});

	it('skips null values without adding them to the Set', async () => {
		vi.spyOn(IngestionService, 'findGroupSourceIds').mockResolvedValue(['source-1']);
		setupSelectMock([{ messageIdHeader: null, providerMessageId: null }]);

		const result = await IngestionService.preloadExistingMessageIds('source-1');

		expect(result.knownMessageIds.size).toBe(0);
	});
});
