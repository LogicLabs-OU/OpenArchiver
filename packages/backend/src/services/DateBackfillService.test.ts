/**
 * Smoke tests for DateBackfillService. The queue is fully mocked — we are
 * only asserting the façade contract, not BullMQ behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addMock = vi.fn();
const getJobMock = vi.fn();
const pauseMock = vi.fn();
const resumeMock = vi.fn();
const hgetallMock = vi.fn();

vi.mock('../jobs/queues', () => ({
	dateBackfillQueue: {
		add: addMock,
		getJob: getJobMock,
		pause: pauseMock,
		resume: resumeMock,
		client: Promise.resolve({
			hgetall: hgetallMock,
		}),
	},
}));

import { DateBackfillService } from './DateBackfillService';

describe('DateBackfillService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('start() enqueues a planner job and returns its id', async () => {
		addMock.mockResolvedValueOnce({ id: 'planner-123' });

		const result = await DateBackfillService.start({
			ingestionSourceId: 'src-1',
			batchSize: 50,
		});

		expect(result).toEqual({ jobId: 'planner-123' });
		expect(addMock).toHaveBeenCalledTimes(1);
		const [name, data] = addMock.mock.calls[0];
		expect(name).toBe('date-backfill:plan');
		expect(data).toEqual({ ingestionSourceId: 'src-1', batchSize: 50 });
	});

	it('start() throws when the queue returns no job id', async () => {
		addMock.mockResolvedValueOnce({ id: undefined });
		await expect(DateBackfillService.start({})).rejects.toThrow(/no job id/i);
	});

	it('pause() delegates to queue.pause()', async () => {
		await DateBackfillService.pause();
		expect(pauseMock).toHaveBeenCalledTimes(1);
	});

	it('resume() delegates to queue.resume()', async () => {
		await DateBackfillService.resume();
		expect(resumeMock).toHaveBeenCalledTimes(1);
	});

	it('status() returns BackfillStatus shape with counters', async () => {
		getJobMock.mockResolvedValueOnce({
			getState: async () => 'active',
			processedOn: 1_700_000_000_000,
			finishedOn: null,
		});
		hgetallMock.mockResolvedValueOnce({
			total: '1000',
			scanned: '400',
			updated: '350',
			failed: '5',
		});

		const status = await DateBackfillService.status('planner-123');

		expect(status).toEqual({
			state: 'running',
			jobId: 'planner-123',
			total: 1000,
			scanned: 400,
			updated: 350,
			failed: 5,
			startedAt: new Date(1_700_000_000_000).toISOString(),
			finishedAt: null,
		});
	});

	it('status() reports running when planner is completed but batches still in flight', async () => {
		getJobMock.mockResolvedValueOnce({
			getState: async () => 'completed',
			processedOn: 1_700_000_000_000,
			finishedOn: 1_700_000_100_000,
		});
		hgetallMock.mockResolvedValueOnce({
			total: '1000',
			scanned: '600',
			updated: '590',
			failed: '0',
		});

		const status = await DateBackfillService.status('planner-456');
		expect(status.state).toBe('running');
	});

	it('status() reports completed when scanned has caught up with total', async () => {
		getJobMock.mockResolvedValueOnce({
			getState: async () => 'completed',
			processedOn: 1_700_000_000_000,
			finishedOn: 1_700_000_100_000,
		});
		hgetallMock.mockResolvedValueOnce({
			total: '500',
			scanned: '500',
			updated: '450',
			failed: '10',
		});

		const status = await DateBackfillService.status('planner-789');
		expect(status.state).toBe('completed');
	});

	it('status() throws when job is unknown', async () => {
		getJobMock.mockResolvedValueOnce(undefined);
		await expect(DateBackfillService.status('missing')).rejects.toThrow(/not found/i);
	});
});
