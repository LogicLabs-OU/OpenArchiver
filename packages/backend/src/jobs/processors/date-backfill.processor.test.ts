/**
 * Unit tests for the date-backfill row-update decision logic.
 *
 * The full processor pulls in BullMQ, Drizzle, storage, and mailparser — all
 * heavy dependencies. We pin the algorithmic core (`decideRowUpdate`) plus a
 * thin smoke test of the per-row branch in `runBatch` via aggressive mocking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

vi.mock('mailparser', () => ({
	simpleParser: vi.fn(async () => ({
		date: new Date('2024-06-01T12:00:00Z'),
		headers: new Map(),
		headerLines: [],
	})),
}));

vi.mock('../../helpers/dateExtractor', () => ({
	extractOriginalDate: vi.fn(() => ({
		date: new Date('2024-06-01T12:00:00Z'),
		source: 'header',
	})),
}));

// Mock both queues so we never touch redis.
vi.mock('../queues', () => ({
	dateBackfillQueue: {
		client: Promise.resolve({
			hset: vi.fn(async () => 1),
			hgetall: vi.fn(async () => ({})),
			hincrby: vi.fn(async () => 1),
			expire: vi.fn(async () => 1),
		}),
		add: vi.fn(async () => ({ id: 'planner-1' })),
	},
	indexingQueue: {
		add: vi.fn(async () => ({ id: 'index-batch-1' })),
	},
}));

// Mock DB + Storage modules so importing the processor doesn't pull pg/etc.
const { updateMock, selectMock, storageGetMock } = vi.hoisted(() => ({
	updateMock: vi.fn(),
	selectMock: vi.fn(),
	storageGetMock: vi.fn(),
}));
vi.mock('../../services/DatabaseService', () => ({
	DatabaseService: class {
		db = {
			select: selectMock,
			update: updateMock,
		};
	},
}));

vi.mock('../../services/StorageService', () => ({
	StorageService: class {
		get = storageGetMock;
	},
}));

vi.mock('../../helpers/streamToBuffer', () => ({
	streamToBuffer: vi.fn(async () => Buffer.from('raw bytes')),
}));

import { decideRowUpdate } from './date-backfill.processor';

describe('decideRowUpdate', () => {
	const baseExtracted = {
		extractedDate: new Date('2024-06-01T12:00:00Z'),
		extractedSource: 'header' as const,
	};

	it('updates when current sentAt is null and a date was extracted', () => {
		expect(
			decideRowUpdate({
				currentSentAt: null,
				currentSource: 'header',
				...baseExtracted,
			})
		).toEqual({ update: true, reason: 'fills-null-sent-at' });
	});

	it('does NOT update when current sentAt is within 1h of extracted', () => {
		expect(
			decideRowUpdate({
				currentSentAt: new Date('2024-06-01T12:30:00Z'), // +30min
				currentSource: 'header',
				...baseExtracted,
			})
		).toEqual({ update: false, reason: 'no-change' });
	});

	it('updates when current sentAt drifts more than 1h from extracted', () => {
		expect(
			decideRowUpdate({
				currentSentAt: new Date('2024-06-01T15:00:00Z'), // +3h
				currentSource: 'header',
				...baseExtracted,
			})
		).toEqual({ update: true, reason: 'sent-at-drift-exceeds-tolerance' });
	});

	it('updates when source label changes (even if date matches)', () => {
		expect(
			decideRowUpdate({
				currentSentAt: new Date('2024-06-01T12:00:00Z'),
				currentSource: 'received',
				...baseExtracted,
			})
		).toEqual({ update: true, reason: 'source-changed' });
	});

	it('does NOT update when neither date nor source changed', () => {
		expect(
			decideRowUpdate({
				currentSentAt: new Date('2024-06-01T12:00:00Z'),
				currentSource: 'header',
				...baseExtracted,
			})
		).toEqual({ update: false, reason: 'no-change' });
	});

	it('handles null extracted date with non-null current — no update', () => {
		expect(
			decideRowUpdate({
				currentSentAt: new Date('2024-06-01T12:00:00Z'),
				currentSource: 'header',
				extractedDate: null,
				extractedSource: 'header',
			})
		).toEqual({ update: false, reason: 'no-change' });
	});

	it('updates when both null sentAt AND source changed (the null-fill wins)', () => {
		// fills-null-sent-at branch matches first; either reason is acceptable
		// as long as update=true.
		const r = decideRowUpdate({
			currentSentAt: null,
			currentSource: 'received',
			...baseExtracted,
		});
		expect(r.update).toBe(true);
	});
});

describe('runBatch row failure handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('marks a row scanned and increments failed when storage throws', async () => {
		// Set up DB select to return one row, storage.get to throw, and
		// update to succeed for the failure-scan branch.
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [
						{
							id: 'row-1',
							sentAt: null,
							originalDateSource: 'header',
							storagePath: '/missing.eml',
							ingestionSourceId: 'src-1',
						},
					],
				}),
			}),
		});
		updateMock.mockReturnValue({
			set: () => ({
				where: async () => undefined,
			}),
		});
		storageGetMock.mockRejectedValueOnce(new Error('storage gone'));

		const processor = (await import('./date-backfill.processor')).default;
		const job = {
			name: 'date-backfill:batch',
			id: 'batch-1',
			data: { archivedEmailIds: ['row-1'], plannerJobId: 'planner-1' },
		} as any;

		const result = (await processor(job)) as {
			processedIds: number;
			updated: number;
			failed: number;
		};

		expect(result.processedIds).toBe(1);
		expect(result.updated).toBe(0);
		expect(result.failed).toBe(1);
		// Storage was called and threw; we should still have called update
		// to set dateBackfilledAt.
		expect(storageGetMock).toHaveBeenCalledWith('/missing.eml');
		expect(updateMock).toHaveBeenCalled();
	});

	it('updates a row when sentAt was null and extractor returned a date', async () => {
		selectMock.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [
						{
							id: 'row-2',
							sentAt: null,
							originalDateSource: 'header',
							storagePath: '/ok.eml',
							ingestionSourceId: 'src-1',
						},
					],
				}),
			}),
		});
		updateMock.mockReturnValue({
			set: () => ({
				where: async () => undefined,
			}),
		});
		storageGetMock.mockResolvedValueOnce(Readable.from(Buffer.from('raw')));

		const processor = (await import('./date-backfill.processor')).default;
		const job = {
			name: 'date-backfill:batch',
			id: 'batch-2',
			data: { archivedEmailIds: ['row-2'], plannerJobId: 'planner-2' },
		} as any;

		const result = (await processor(job)) as {
			processedIds: number;
			updated: number;
			failed: number;
		};

		expect(result.processedIds).toBe(1);
		expect(result.updated).toBe(1);
		expect(result.failed).toBe(0);
	});
});
