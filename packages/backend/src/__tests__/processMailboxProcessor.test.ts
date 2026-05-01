import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPreload } = vi.hoisted(() => {
	const preloadedIds = new Set(['<existing@mail.com>', 'uid-100']);
	return {
		mockPreload: vi.fn().mockResolvedValue({
			knownMessageIds: preloadedIds,
			groupSourceIds: ['source-1'],
		}),
	};
});

vi.mock('bullmq', () => ({
	Job: vi.fn(),
	Queue: vi.fn(),
}));

vi.mock('@open-archiver/types', () => ({
	IProcessMailboxJob: {},
	ProcessMailboxError: {},
	PendingEmail: {},
}));

vi.mock('../services/IngestionService', () => {
	function MockIngestionService(this: any) {
		this.processEmail = vi.fn().mockResolvedValue(null);
	}
	MockIngestionService.findById = vi.fn().mockResolvedValue({
		id: 'source-1',
		name: 'Test Source',
		provider: 'generic_imap',
		credentials: { type: 'generic_imap' },
		syncState: null,
		mergedIntoId: null,
	});
	MockIngestionService.preloadExistingMessageIds = mockPreload;
	MockIngestionService.findGroupSourceIds = vi.fn().mockResolvedValue(['source-1']);
	return { IngestionService: MockIngestionService };
});

vi.mock('../services/EmailProviderFactory', () => ({
	EmailProviderFactory: {
		createConnector: vi.fn().mockReturnValue({
			fetchEmails: vi.fn().mockImplementation(async function* () {
				yield null;
			}),
			getUpdatedSyncState: vi.fn().mockReturnValue({ imap: {} }),
		}),
	},
}));

vi.mock('../services/StorageService', () => ({
	StorageService: vi.fn().mockImplementation(function () {
		return {};
	}),
}));

vi.mock('../config', () => ({
	config: {
		meili: { indexingBatchSize: 100 },
		storage: { openArchiverFolderName: 'open-archiver' },
	},
}));

vi.mock('../config/logger', () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../jobs/queues', () => ({
	indexingQueue: { add: vi.fn() },
	ingestionQueue: { add: vi.fn() },
}));

vi.mock('../services/SyncSessionService', () => ({
	SyncSessionService: {
		recordMailboxResult: vi.fn().mockResolvedValue({ isLast: false, totalFailed: 0 }),
		heartbeat: vi.fn(),
	},
}));

import { processMailboxProcessor } from '../jobs/processors/process-mailbox.processor';
import { IngestionService } from '../services/IngestionService';
import { EmailProviderFactory } from '../services/EmailProviderFactory';

function makeJob(overrides: Record<string, any> = {}) {
	return {
		data: {
			ingestionSourceId: 'source-1',
			userEmail: 'user@mail.com',
			sessionId: 'session-1',
			...overrides,
		},
	} as any;
}

describe('processMailboxProcessor — bulk pre-load integration (Change 1)', () => {
	beforeEach(() => {
		vi.mocked(IngestionService.findById).mockResolvedValue({
			id: 'source-1',
			name: 'Test Source',
			provider: 'generic_imap',
			credentials: { type: 'generic_imap' },
			syncState: null,
			mergedIntoId: null,
		} as any);
		vi.mocked(mockPreload).mockResolvedValue({
			knownMessageIds: new Set(['<existing@mail.com>', 'uid-100']),
			groupSourceIds: ['source-1'],
		});
		vi.mocked(EmailProviderFactory.createConnector).mockReturnValue({
			fetchEmails: vi.fn().mockImplementation(async function* () {
				yield null;
			}),
			getUpdatedSyncState: vi.fn().mockReturnValue({ imap: {} }),
		} as any);
	});

	it('calls preloadExistingMessageIds before fetching emails', async () => {
		await processMailboxProcessor(makeJob());

		expect(IngestionService.preloadExistingMessageIds).toHaveBeenCalledWith('source-1');
	});

	it('checkDuplicate uses in-memory Set, not DB per-email queries', async () => {
		const connectorMock = {
			fetchEmails: vi.fn().mockImplementation(async function* (
				_userEmail: string,
				_syncState: any,
				checkDuplicate: (id: string) => Promise<boolean>
			) {
				const isDup = await checkDuplicate('<existing@mail.com>');
				expect(isDup).toBe(true);

				const isNotDup = await checkDuplicate('<new@mail.com>');
				expect(isNotDup).toBe(false);

				yield null;
			}),
			getUpdatedSyncState: vi.fn().mockReturnValue({ imap: {} }),
		};
		vi.mocked(EmailProviderFactory.createConnector).mockReturnValue(connectorMock as any);

		await processMailboxProcessor(makeJob());

		expect(connectorMock.fetchEmails).toHaveBeenCalled();
	});
});
