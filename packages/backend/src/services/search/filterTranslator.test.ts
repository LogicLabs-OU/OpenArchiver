import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock IngestionService BEFORE importing the translator so the static call
// inside renderIngestionSourceId picks up the mock.
vi.mock('../IngestionService', () => ({
	IngestionService: {
		findGroupSourceIds: vi.fn(async (id: string) => [id]),
	},
}));

import { translateFilters, FilterValidationError } from './filterTranslator';
import { IngestionService } from '../IngestionService';

const mockedFindGroup = vi.mocked(IngestionService.findGroupSourceIds);

describe('translateFilters', () => {
	beforeEach(() => {
		mockedFindGroup.mockReset();
		mockedFindGroup.mockImplementation(async (id: string) => [id]);
	});

	describe('empty input', () => {
		it('returns null for undefined', async () => {
			await expect(translateFilters(undefined)).resolves.toBeNull();
		});

		it('returns null for empty object', async () => {
			await expect(translateFilters({})).resolves.toBeNull();
		});
	});

	describe('string fields', () => {
		it('renders eq', async () => {
			const out = await translateFilters({
				from: { op: 'eq', value: 'alice@acme.com' },
			});
			expect(out).toBe("from = 'alice@acme.com'");
		});

		it('renders contains', async () => {
			const out = await translateFilters({
				from: { op: 'contains', value: '@acme.com' },
			});
			expect(out).toBe("from CONTAINS '@acme.com'");
		});

		it('renders in', async () => {
			const out = await translateFilters({
				from: { op: 'in', value: ['a@x.com', 'b@x.com'] },
			});
			expect(out).toBe("from IN ['a@x.com', 'b@x.com']");
		});

		it('escapes single quotes (injection guard)', async () => {
			const out = await translateFilters({
				from: { op: 'eq', value: "evil'; DROP TABLE --" },
			});
			expect(out).toBe("from = 'evil''; DROP TABLE --'");
		});
	});

	describe('stringArray fields', () => {
		it('renders in', async () => {
			const out = await translateFilters({
				to: { op: 'in', value: ['a@x.com', 'b@x.com'] },
			});
			expect(out).toBe("to IN ['a@x.com', 'b@x.com']");
		});

		it('renders any (alias for in semantics)', async () => {
			const out = await translateFilters({
				to: { op: 'any', value: ['a@x.com'] },
			});
			expect(out).toBe("to IN ['a@x.com']");
		});

		it('renders all as conjunction', async () => {
			const out = await translateFilters({
				to: { op: 'all', value: ['a@x.com', 'b@x.com'] },
			});
			expect(out).toBe("to = 'a@x.com' AND to = 'b@x.com'");
		});

		it('caps all at 50', async () => {
			const big = Array.from({ length: 51 }, (_, i) => `u${i}@x.com`);
			await expect(
				translateFilters({ to: { op: 'all', value: big } })
			).rejects.toBeInstanceOf(FilterValidationError);
		});

		it('caps in at 100', async () => {
			const big = Array.from({ length: 101 }, (_, i) => `u${i}@x.com`);
			await expect(
				translateFilters({ to: { op: 'in', value: big } })
			).rejects.toBeInstanceOf(FilterValidationError);
		});
	});

	describe('timestamp field', () => {
		it('renders eq from ISO string', async () => {
			const out = await translateFilters({
				timestamp: { op: 'eq', value: '2025-01-01T00:00:00Z' },
			});
			expect(out).toBe(`timestamp = ${Date.parse('2025-01-01T00:00:00Z')}`);
		});

		it('renders gte', async () => {
			const out = await translateFilters({
				timestamp: { op: 'gte', value: '2025-01-01T00:00:00Z' },
			});
			expect(out).toBe(`timestamp >= ${Date.parse('2025-01-01T00:00:00Z')}`);
		});

		it('renders lte', async () => {
			const out = await translateFilters({
				timestamp: { op: 'lte', value: '2025-01-01T00:00:00Z' },
			});
			expect(out).toBe(`timestamp <= ${Date.parse('2025-01-01T00:00:00Z')}`);
		});

		it('renders between', async () => {
			const lo = '2025-01-01T00:00:00Z';
			const hi = '2025-04-01T00:00:00Z';
			const out = await translateFilters({
				timestamp: { op: 'between', value: [lo, hi] },
			});
			expect(out).toBe(`timestamp ${Date.parse(lo)} TO ${Date.parse(hi)}`);
		});

		it('rejects unparseable date', async () => {
			await expect(
				translateFilters({
					timestamp: { op: 'eq', value: 'not-a-date' },
				})
			).rejects.toBeInstanceOf(FilterValidationError);
		});
	});

	describe('ingestionSourceId', () => {
		it('accepts bare string and expands group with one ID', async () => {
			mockedFindGroup.mockResolvedValueOnce(['src-1']);
			const out = await translateFilters({ ingestionSourceId: 'src-1' });
			expect(out).toBe("ingestionSourceId = 'src-1'");
			expect(mockedFindGroup).toHaveBeenCalledWith('src-1');
		});

		it('accepts {op:eq} shorthand and expands group with multiple IDs', async () => {
			mockedFindGroup.mockResolvedValueOnce(['src-1', 'src-2', 'src-3']);
			const out = await translateFilters({
				ingestionSourceId: { op: 'eq', value: 'src-1' },
			});
			expect(out).toBe("ingestionSourceId IN ['src-1', 'src-2', 'src-3']");
		});

		it('rejects disallowed ops on ingestionSourceId', async () => {
			await expect(
				translateFilters({
					ingestionSourceId: { op: 'contains', value: 'src' } as unknown as never,
				})
			).rejects.toBeInstanceOf(FilterValidationError);
		});

		it('expands group for {op:in, value:[ids]}', async () => {
			mockedFindGroup
				.mockResolvedValueOnce(['src-1', 'src-2'])
				.mockResolvedValueOnce(['src-3']);
			const out = await translateFilters({
				ingestionSourceId: { op: 'in', value: ['src-1', 'src-3'] },
			});
			expect(out).toBe("ingestionSourceId IN ['src-1', 'src-2', 'src-3']");
		});
	});

	describe('userEmail', () => {
		it('renders eq', async () => {
			const out = await translateFilters({
				userEmail: { op: 'eq', value: 'alice@acme.com' },
			});
			expect(out).toBe("userEmail = 'alice@acme.com'");
		});
	});

	describe('joining', () => {
		it('joins clauses with AND', async () => {
			const out = await translateFilters({
				from: { op: 'eq', value: 'a@x.com' },
				userEmail: { op: 'eq', value: 'u@y.com' },
			});
			expect(out).toBe("from = 'a@x.com' AND userEmail = 'u@y.com'");
		});
	});

	describe('error cases', () => {
		it('throws on unknown field', async () => {
			await expect(
				translateFilters({ fake: { op: 'eq', value: 'x' } } as never)
			).rejects.toThrow(/unknown field/);
		});

		it('throws on wrong op for kind', async () => {
			await expect(
				translateFilters({
					from: { op: 'between', value: ['a', 'b'] } as unknown as never,
				})
			).rejects.toBeInstanceOf(FilterValidationError);
		});

		it('throws on empty array', async () => {
			await expect(
				translateFilters({ to: { op: 'in', value: [] } })
			).rejects.toBeInstanceOf(FilterValidationError);
		});

		it('throws on type mismatch (number for string)', async () => {
			await expect(
				translateFilters({
					from: { op: 'eq', value: 42 } as unknown as never,
				})
			).rejects.toBeInstanceOf(FilterValidationError);
		});
	});

	describe('P3-gated fields rejected until FIELD_KINDS extends', () => {
		const cases: Array<[string, unknown]> = [
			['path', { op: 'in', value: ['/Inbox'] }],
			['tags', { op: 'in', value: ['urgent'] }],
			['hasAttachments', true],
			['sizeBytes', { op: 'gte', value: 1000 }],
			['isOnLegalHold', true],
			['threadId', { op: 'eq', value: 't1' }],
			['subject', { op: 'contains', value: 'invoice' }],
		];
		for (const [field, value] of cases) {
			it(`rejects ${field}`, async () => {
				await expect(
					translateFilters({ [field]: value } as never)
				).rejects.toThrow(/unknown field/);
			});
		}

		it('rejects attachments.sha256 (flattened)', async () => {
			await expect(
				translateFilters({
					attachments: { sha256: { op: 'eq', value: 'abc' } },
				})
			).rejects.toThrow(/unknown field/);
		});
	});

	describe('FilterValidationError shape', () => {
		it('carries field and reason properties', async () => {
			try {
				await translateFilters({ fake: 'x' } as never);
				expect.fail('should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(FilterValidationError);
				const fve = err as FilterValidationError;
				expect(fve.field).toBe('fake');
				expect(typeof fve.reason).toBe('string');
			}
		});
	});
});
