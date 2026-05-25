// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { emptyDraft, toApiSearchQuery } from './url-state';

/**
 * Tests for empty-filter pruning in `toApiSearchQuery`.
 *
 * Per sub-plan §4:
 *  - chip array length 0 → omit
 *  - trimmed string '' → omit
 *  - timestamp without complete from/to (and no preset) → omit
 *  - tri-state 'any' with no chips → omit
 *  - size with both min and max null/undefined → omit
 *
 * Each filter type has one "empty" case (assert the key is absent from the
 * resulting SearchQuery.filters) and one "non-empty" case (assert a clause is
 * emitted).
 */

describe('toApiSearchQuery — top-level pruning', () => {
	it('empty draft yields a SearchQuery with no filters block at all', () => {
		const out = toApiSearchQuery(emptyDraft());
		expect(out.filters).toBeUndefined();
	});

	it('trimmed-empty query is dropped, non-empty kept', () => {
		const d = emptyDraft();
		d.query = '   ';
		expect(toApiSearchQuery(d).query).toBeUndefined();

		d.query = '  foo  ';
		expect(toApiSearchQuery(d).query).toBe('foo');
	});

	it('explicit sort always wins, even with a query', () => {
		const d = emptyDraft();
		d.query = 'foo';
		d.sort = [{ field: 'timestamp', dir: 'asc' }];
		expect(toApiSearchQuery(d).sort).toEqual([{ field: 'timestamp', dir: 'asc' }]);
	});

	it('empty sort with a query leaves sort undefined (relevance ranking)', () => {
		const d = emptyDraft();
		d.query = 'foo';
		expect(toApiSearchQuery(d).sort).toBeUndefined();
	});

	it('empty sort with no query falls back to timestamp:desc (filter-only browse)', () => {
		const d = emptyDraft();
		expect(toApiSearchQuery(d).sort).toEqual([{ field: 'timestamp', dir: 'desc' }]);
	});
});

describe('toApiSearchQuery — string filters', () => {
	it('from: trimmed empty contains is dropped; non-empty kept', () => {
		const d = emptyDraft();
		d.filters.from = { op: 'contains', value: '   ' };
		expect(toApiSearchQuery(d).filters).toBeUndefined();

		d.filters.from = { op: 'contains', value: '  @acme.com  ' };
		expect(toApiSearchQuery(d).filters?.from).toEqual({
			op: 'contains',
			value: '@acme.com',
		});
	});

	it('subject: empty dropped, non-empty kept', () => {
		const d = emptyDraft();
		d.filters.subject = { op: 'contains', value: '' };
		expect(toApiSearchQuery(d).filters).toBeUndefined();

		d.filters.subject = { op: 'contains', value: 'invoice' };
		expect(toApiSearchQuery(d).filters?.subject).toEqual({
			op: 'contains',
			value: 'invoice',
		});
	});

	it('userEmail: empty dropped, non-empty kept', () => {
		const d = emptyDraft();
		d.filters.userEmail = { op: 'in', value: [] };
		expect(toApiSearchQuery(d).filters).toBeUndefined();

		d.filters.userEmail = { op: 'in', value: ['alice@x'] };
		expect(toApiSearchQuery(d).filters?.userEmail).toEqual({
			op: 'in',
			value: ['alice@x'],
		});
	});
});

describe('toApiSearchQuery — string-array filters (chips)', () => {
	it('to: empty chip list dropped, non-empty kept', () => {
		const d = emptyDraft();
		d.filters.to = { op: 'in', value: [] };
		expect(toApiSearchQuery(d).filters).toBeUndefined();

		d.filters.to = { op: 'in', value: ['a@x', 'b@x'] };
		expect(toApiSearchQuery(d).filters?.to).toEqual({
			op: 'in',
			value: ['a@x', 'b@x'],
		});
	});

	it('to: whitespace-only chip is filtered out', () => {
		const d = emptyDraft();
		d.filters.to = { op: 'in', value: ['  ', '', 'real@x'] };
		expect(toApiSearchQuery(d).filters?.to).toEqual({
			op: 'in',
			value: ['real@x'],
		});
	});

	it('cc, bcc: empty dropped, non-empty kept', () => {
		const d = emptyDraft();
		d.filters.cc = { op: 'in', value: [] };
		d.filters.bcc = { op: 'in', value: [] };
		expect(toApiSearchQuery(d).filters).toBeUndefined();

		d.filters.cc = { op: 'in', value: ['c@x'] };
		d.filters.bcc = { op: 'in', value: ['b@x'] };
		const out = toApiSearchQuery(d).filters;
		expect(out?.cc).toEqual({ op: 'in', value: ['c@x'] });
		expect(out?.bcc).toEqual({ op: 'in', value: ['b@x'] });
	});

	it("tags 'any' with no chips is dropped, with chips is kept", () => {
		const d = emptyDraft();
		d.filters.tags = { op: 'any', value: [] };
		expect(toApiSearchQuery(d).filters).toBeUndefined();

		d.filters.tags = { op: 'any', value: ['hot'] };
		expect(toApiSearchQuery(d).filters?.tags).toEqual({
			op: 'any',
			value: ['hot'],
		});
	});
});

describe('toApiSearchQuery — timestamp', () => {
	it('between with missing `to` is dropped (and no preset)', () => {
		const d = emptyDraft();
		d.filters.timestamp = { op: 'between', value: ['2025-01-01', ''] };
		expect(toApiSearchQuery(d).filters).toBeUndefined();
	});

	it('between with both ends is kept (no preset)', () => {
		const d = emptyDraft();
		d.filters.timestamp = {
			op: 'between',
			value: ['2025-01-01', '2025-12-31'],
		};
		expect(toApiSearchQuery(d).filters?.timestamp).toEqual({
			op: 'between',
			value: ['2025-01-01', '2025-12-31'],
		});
	});

	it('preset resolves to concrete ISO strings at call time', () => {
		const d = emptyDraft();
		d.datePreset = 'today';
		const out = toApiSearchQuery(d);
		expect(out.filters?.timestamp).toBeDefined();
		const ts = out.filters!.timestamp!;
		expect(ts.op).toBe('between');
		if (ts.op === 'between') {
			expect(typeof ts.value[0]).toBe('string');
			expect(typeof ts.value[1]).toBe('string');
			// Today's ISO range is non-empty.
			expect(ts.value[0].length).toBeGreaterThan(0);
			expect(ts.value[1].length).toBeGreaterThan(0);
			// from must be lexicographically <= to for any preset.
			expect(ts.value[0] <= ts.value[1]).toBe(true);
		}
	});

	it('custom preset uses explicit from/to in the draft', () => {
		const d = emptyDraft();
		d.datePreset = 'custom';
		d.filters.timestamp = {
			op: 'between',
			value: ['2025-04-01', '2025-04-30'],
		};
		expect(toApiSearchQuery(d).filters?.timestamp).toEqual({
			op: 'between',
			value: ['2025-04-01', '2025-04-30'],
		});
	});

	it.each([
		'yesterday',
		'last-7d',
		'last-30d',
		'this-month',
		'last-month',
		'this-year',
		'last-year',
	] as const)('preset %s resolves to a usable ISO range', (preset) => {
		const d = emptyDraft();
		d.datePreset = preset;
		const ts = toApiSearchQuery(d).filters?.timestamp;
		expect(ts).toBeDefined();
		expect(ts!.op).toBe('between');
		if (ts!.op === 'between') {
			expect(ts!.value[0] <= ts!.value[1]).toBe(true);
		}
	});
});

describe('toApiSearchQuery — sizeBytes (min/max → op shape)', () => {
	it('both min and max null → dropped', () => {
		const d = emptyDraft();
		d.filters.sizeBytes = { op: 'between', value: [null as never, null as never] };
		expect(toApiSearchQuery(d).filters).toBeUndefined();
	});

	it('only min → emits gte', () => {
		const d = emptyDraft();
		d.filters.sizeBytes = { op: 'between', value: [1024, null as never] };
		expect(toApiSearchQuery(d).filters?.sizeBytes).toEqual({
			op: 'gte',
			value: 1024,
		});
	});

	it('only max → emits lte', () => {
		const d = emptyDraft();
		d.filters.sizeBytes = { op: 'between', value: [null as never, 4096] };
		expect(toApiSearchQuery(d).filters?.sizeBytes).toEqual({
			op: 'lte',
			value: 4096,
		});
	});

	it('both → emits between', () => {
		const d = emptyDraft();
		d.filters.sizeBytes = { op: 'between', value: [1, 99] };
		expect(toApiSearchQuery(d).filters?.sizeBytes).toEqual({
			op: 'between',
			value: [1, 99],
		});
	});
});

describe('toApiSearchQuery — path', () => {
	it('empty include AND empty exclude → dropped', () => {
		const d = emptyDraft();
		d.filters.path = { op: 'in', value: [], exclude: [] };
		expect(toApiSearchQuery(d).filters).toBeUndefined();
	});

	it('only include → kept without exclude key', () => {
		const d = emptyDraft();
		d.filters.path = { op: 'in', value: ['Inbox'] };
		expect(toApiSearchQuery(d).filters?.path).toEqual({
			op: 'in',
			value: ['Inbox'],
		});
	});

	it('only exclude → kept as exclude-only clause', () => {
		const d = emptyDraft();
		d.filters.path = { op: 'in', value: [], exclude: ['Spam'] };
		expect(toApiSearchQuery(d).filters?.path).toEqual({
			op: 'in',
			value: [],
			exclude: ['Spam'],
		});
	});

	it('whitespace-only entries are filtered', () => {
		const d = emptyDraft();
		d.filters.path = {
			op: 'in',
			value: ['  ', 'Inbox'],
			exclude: ['', 'Spam'],
		};
		expect(toApiSearchQuery(d).filters?.path).toEqual({
			op: 'in',
			value: ['Inbox'],
			exclude: ['Spam'],
		});
	});
});

describe('toApiSearchQuery — boolean shortcuts', () => {
	it('hasAttachments true is emitted as-is', () => {
		const d = emptyDraft();
		d.filters.hasAttachments = true;
		expect(toApiSearchQuery(d).filters?.hasAttachments).toBe(true);
	});

	it('hasAttachments false is emitted as-is (explicit "no attachments" filter)', () => {
		const d = emptyDraft();
		d.filters.hasAttachments = false;
		expect(toApiSearchQuery(d).filters?.hasAttachments).toBe(false);
	});

	it('isOnLegalHold true is emitted as-is', () => {
		const d = emptyDraft();
		d.filters.isOnLegalHold = true;
		expect(toApiSearchQuery(d).filters?.isOnLegalHold).toBe(true);
	});

	it('booleans absent → no filters block', () => {
		const d = emptyDraft();
		expect(toApiSearchQuery(d).filters).toBeUndefined();
	});
});

describe('toApiSearchQuery — ingestionSourceId', () => {
	it('empty chip list dropped', () => {
		const d = emptyDraft();
		d.filters.ingestionSourceId = { op: 'in', value: [] };
		expect(toApiSearchQuery(d).filters).toBeUndefined();
	});

	it('non-empty kept', () => {
		const d = emptyDraft();
		d.filters.ingestionSourceId = { op: 'in', value: ['uuid-1'] };
		expect(toApiSearchQuery(d).filters?.ingestionSourceId).toEqual({
			op: 'in',
			value: ['uuid-1'],
		});
	});
});

describe('toApiSearchQuery — attachments.sha256', () => {
	it('empty value dropped', () => {
		const d = emptyDraft();
		d.filters.attachments = { sha256: { op: 'eq', value: '' } };
		expect(toApiSearchQuery(d).filters).toBeUndefined();
	});

	it('non-empty kept', () => {
		const d = emptyDraft();
		d.filters.attachments = { sha256: { op: 'eq', value: 'abc' } };
		expect(toApiSearchQuery(d).filters?.attachments).toEqual({
			sha256: { op: 'eq', value: 'abc' },
		});
	});
});
