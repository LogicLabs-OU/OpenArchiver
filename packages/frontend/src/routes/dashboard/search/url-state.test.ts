// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { SearchQuery } from '@open-archiver/types';
import {
	decodeSearchParams,
	encodeSearchParams,
	emptyDraft,
	fromApiSearchQuery,
	hasAnyFilter,
	toApiSearchQuery,
	type SearchQueryDraft,
} from './url-state';

/**
 * Helper: round-trip a draft through encode -> decode and assert equality.
 * Returns the decoded draft so callers can make additional assertions.
 */
function roundTrip(draft: SearchQueryDraft): SearchQueryDraft {
	const params = encodeSearchParams(draft);
	// Confirm a freshly-parsed URLSearchParams string also decodes the same
	// (catches any encoding-layer bugs).
	const reparsed = new URLSearchParams(params.toString());
	return decodeSearchParams(reparsed);
}

describe('url-state — empty / minimal cases', () => {
	it('empty draft encodes to empty URLSearchParams', () => {
		const params = encodeSearchParams(emptyDraft());
		expect(params.toString()).toBe('');
	});

	it('round-trips an empty draft', () => {
		const out = roundTrip(emptyDraft());
		expect(out).toEqual(emptyDraft());
	});

	it("round-trips q='foo' only", () => {
		const d = emptyDraft();
		d.query = 'foo';
		const out = roundTrip(d);
		expect(out.query).toBe('foo');
		expect(Object.keys(out.filters)).toHaveLength(0);
	});
});

describe('url-state — single filter round-trips', () => {
	it('from contains', () => {
		const d = emptyDraft();
		d.filters.from = { op: 'contains', value: '@acme.com' };
		const out = roundTrip(d);
		expect(out.filters.from).toEqual({ op: 'contains', value: '@acme.com' });
	});

	it('to in[a,b,c] — repeated-key encoding', () => {
		const d = emptyDraft();
		d.filters.to = { op: 'in', value: ['a@x', 'b@x', 'c@x'] };
		const params = encodeSearchParams(d);
		expect(params.getAll('f.to.v')).toEqual(['a@x', 'b@x', 'c@x']);
		expect(params.get('f.to.op')).toBe('in');
		const out = roundTrip(d);
		expect(out.filters.to).toEqual({ op: 'in', value: ['a@x', 'b@x', 'c@x'] });
	});

	it('subject contains', () => {
		const d = emptyDraft();
		d.filters.subject = { op: 'contains', value: 'invoice' };
		const out = roundTrip(d);
		expect(out.filters.subject).toEqual({ op: 'contains', value: 'invoice' });
	});

	it('timestamp between (explicit, no preset)', () => {
		const d = emptyDraft();
		d.filters.timestamp = {
			op: 'between',
			value: ['2025-10-01', '2025-12-31'],
		};
		const out = roundTrip(d);
		expect(out.filters.timestamp).toEqual({
			op: 'between',
			value: ['2025-10-01', '2025-12-31'],
		});
		expect(out.datePreset).toBeUndefined();
	});

	it('timestamp with preset — preset wins, concrete dates dropped from URL', () => {
		const d = emptyDraft();
		d.datePreset = 'last-30d';
		// Even if the caller put concrete from/to in the draft (shouldn't happen
		// when preset is set), the URL form must not echo them.
		d.filters.timestamp = {
			op: 'between',
			value: ['2025-10-01', '2025-12-31'],
		};
		const params = encodeSearchParams(d);
		expect(params.get('f.ts.preset')).toBe('last-30d');
		expect(params.get('f.ts.from')).toBeNull();
		expect(params.get('f.ts.to')).toBeNull();
		expect(params.get('f.ts.op')).toBeNull();

		const out = decodeSearchParams(new URLSearchParams(params.toString()));
		expect(out.datePreset).toBe('last-30d');
		expect(out.filters.timestamp).toBeUndefined();
	});

	it('timestamp preset=custom is preserved but does not drop explicit dates', () => {
		const d = emptyDraft();
		d.datePreset = 'custom';
		d.filters.timestamp = {
			op: 'between',
			value: ['2025-01-01', '2025-06-30'],
		};
		const out = roundTrip(d);
		expect(out.datePreset).toBe('custom');
		expect(out.filters.timestamp).toEqual({
			op: 'between',
			value: ['2025-01-01', '2025-06-30'],
		});
	});

	it('ingestionSourceId in[uuid1, uuid2]', () => {
		const d = emptyDraft();
		d.filters.ingestionSourceId = {
			op: 'in',
			value: ['11111111-2222-3333-4444-555555555555', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
		};
		const params = encodeSearchParams(d);
		expect(params.getAll('f.src.v')).toHaveLength(2);
		const out = roundTrip(d);
		expect(out.filters.ingestionSourceId).toEqual(d.filters.ingestionSourceId);
	});

	it('userEmail in[a,b]', () => {
		const d = emptyDraft();
		d.filters.userEmail = { op: 'in', value: ['alice@x', 'bob@y'] };
		const out = roundTrip(d);
		expect(out.filters.userEmail).toEqual({ op: 'in', value: ['alice@x', 'bob@y'] });
	});

	it('path with include and exclude (repeated-key for both)', () => {
		const d = emptyDraft();
		d.filters.path = { op: 'in', value: ['Inbox', 'Sent'], exclude: ['Spam', 'Trash'] };
		const params = encodeSearchParams(d);
		expect(params.getAll('f.path.v')).toEqual(['Inbox', 'Sent']);
		expect(params.getAll('f.path.x')).toEqual(['Spam', 'Trash']);
		const out = roundTrip(d);
		expect(out.filters.path).toEqual({
			op: 'in',
			value: ['Inbox', 'Sent'],
			exclude: ['Spam', 'Trash'],
		});
	});

	it('hasAttachments true', () => {
		const d = emptyDraft();
		d.filters.hasAttachments = true;
		const params = encodeSearchParams(d);
		expect(params.get('f.att')).toBe('1');
		const out = roundTrip(d);
		expect(out.filters.hasAttachments).toBe(true);
	});

	it('hasAttachments false', () => {
		const d = emptyDraft();
		d.filters.hasAttachments = false;
		const params = encodeSearchParams(d);
		expect(params.get('f.att')).toBe('0');
		const out = roundTrip(d);
		expect(out.filters.hasAttachments).toBe(false);
	});

	it('tags any', () => {
		const d = emptyDraft();
		d.filters.tags = { op: 'any', value: ['important', 'urgent'] };
		const out = roundTrip(d);
		expect(out.filters.tags).toEqual({ op: 'any', value: ['important', 'urgent'] });
	});

	it('attachments.sha256 eq', () => {
		const d = emptyDraft();
		const hex = 'a'.repeat(64);
		d.filters.attachments = { sha256: { op: 'eq', value: hex } };
		const params = encodeSearchParams(d);
		expect(params.get('f.sha')).toBe(hex);
		const out = roundTrip(d);
		expect(out.filters.attachments).toEqual({ sha256: { op: 'eq', value: hex } });
	});

	it('sizeBytes between (both ends)', () => {
		const d = emptyDraft();
		d.filters.sizeBytes = { op: 'between', value: [1000, 5000] };
		const out = roundTrip(d);
		expect(out.filters.sizeBytes).toEqual({ op: 'between', value: [1000, 5000] });
	});

	it('sizeBytes gte', () => {
		const d = emptyDraft();
		d.filters.sizeBytes = { op: 'gte', value: 1024 };
		const out = roundTrip(d);
		expect(out.filters.sizeBytes).toEqual({ op: 'gte', value: 1024 });
	});

	it('sizeBytes lte', () => {
		const d = emptyDraft();
		d.filters.sizeBytes = { op: 'lte', value: 4096 };
		const out = roundTrip(d);
		expect(out.filters.sizeBytes).toEqual({ op: 'lte', value: 4096 });
	});

	it('isOnLegalHold true', () => {
		const d = emptyDraft();
		d.filters.isOnLegalHold = true;
		const params = encodeSearchParams(d);
		expect(params.get('f.hold')).toBe('1');
		const out = roundTrip(d);
		expect(out.filters.isOnLegalHold).toBe(true);
	});
});

describe('url-state — combined and edge cases', () => {
	it('combined: query + from + timestamp + ingestionSourceId round-trips', () => {
		const d = emptyDraft();
		d.query = 'invoice';
		d.filters.from = { op: 'contains', value: '@acme.com' };
		d.filters.timestamp = { op: 'between', value: ['2025-10-01', '2025-12-31'] };
		d.filters.ingestionSourceId = { op: 'in', value: ['uuid-1', 'uuid-2'] };
		const out = roundTrip(d);
		expect(out.query).toBe('invoice');
		expect(out.filters.from).toEqual(d.filters.from);
		expect(out.filters.timestamp).toEqual(d.filters.timestamp);
		expect(out.filters.ingestionSourceId).toEqual(d.filters.ingestionSourceId);
	});

	it('multi-value repeated-key survives encode/decode for tags', () => {
		const d = emptyDraft();
		d.filters.tags = { op: 'all', value: ['a', 'b', 'c', 'd'] };
		const out = roundTrip(d);
		expect(out.filters.tags).toEqual({ op: 'all', value: ['a', 'b', 'c', 'd'] });
	});

	it('multi-value repeated-key survives encode/decode for path include + exclude', () => {
		const d = emptyDraft();
		d.filters.path = {
			op: 'in',
			value: ['A', 'B'],
			exclude: ['X', 'Y', 'Z'],
		};
		const out = roundTrip(d);
		expect(out.filters.path).toEqual(d.filters.path);
	});

	it('special chars: path containing /, &, =, ? survives encode/decode', () => {
		const d = emptyDraft();
		const tricky = ['Inbox/Sub & Folder', 'a=b?c', 'plain'];
		d.filters.path = { op: 'in', value: tricky };
		const params = encodeSearchParams(d);
		// Confirm the URL form is properly percent-escaped (no raw `&` inside a value).
		const serialised = params.toString();
		expect(serialised).toContain('f.path.v=');
		// Round-trip via string form to catch encoding-layer bugs.
		const reparsed = new URLSearchParams(serialised);
		const out = decodeSearchParams(reparsed);
		expect(out.filters.path).toEqual({ op: 'in', value: tricky });
	});

	it('sort=timestamp:desc round-trips', () => {
		const d = emptyDraft();
		d.sort = [{ field: 'timestamp', dir: 'desc' }];
		const params = encodeSearchParams(d);
		expect(params.get('sort')).toBe('timestamp:desc');
		const out = roundTrip(d);
		expect(out.sort).toEqual([{ field: 'timestamp', dir: 'desc' }]);
	});

	it('sort=fake:desc decodes safely (drop unknown fields)', () => {
		const params = new URLSearchParams('sort=fake:desc');
		const out = decodeSearchParams(params);
		expect(out.sort).toEqual([]);
	});

	it('sort=timestamp:sideways decodes safely (drop unknown dir)', () => {
		const params = new URLSearchParams('sort=timestamp:sideways');
		const out = decodeSearchParams(params);
		expect(out.sort).toEqual([]);
	});

	it('matchingStrategy non-default round-trips, default does not emit', () => {
		const d = emptyDraft();
		d.matchingStrategy = 'all';
		const params = encodeSearchParams(d);
		expect(params.get('m')).toBe('all');

		const dDefault = emptyDraft();
		const paramsDefault = encodeSearchParams(dDefault);
		expect(paramsDefault.get('m')).toBeNull();
	});

	it('unknown matchingStrategy in URL is ignored', () => {
		const out = decodeSearchParams(new URLSearchParams('m=bogus'));
		expect(out.matchingStrategy).toBe('last');
	});

	it('page/limit only emitted when non-default', () => {
		const d = emptyDraft();
		d.page = 1;
		d.limit = 25;
		expect(encodeSearchParams(d).toString()).toBe('');
		d.page = 2;
		d.limit = 50;
		const params = encodeSearchParams(d);
		expect(params.get('page')).toBe('2');
		expect(params.get('limit')).toBe('50');
	});
});

describe('url-state — hasAnyFilter', () => {
	it('returns false for an empty draft', () => {
		expect(hasAnyFilter(emptyDraft())).toBe(false);
	});

	it('returns true when a non-custom date preset is set', () => {
		const d = emptyDraft();
		d.datePreset = 'last-7d';
		expect(hasAnyFilter(d)).toBe(true);
	});

	it('returns true for a single filter', () => {
		const d = emptyDraft();
		d.filters.from = { op: 'contains', value: 'x' };
		expect(hasAnyFilter(d)).toBe(true);
	});

	it('returns true for a boolean filter', () => {
		const d = emptyDraft();
		d.filters.hasAttachments = true;
		expect(hasAnyFilter(d)).toBe(true);
	});
});

describe('url-state — fromApiSearchQuery is the inverse of toApiSearchQuery (sans preset)', () => {
	it('round-trips a typical query', () => {
		const api: SearchQuery = {
			query: 'foo',
			page: 2,
			limit: 50,
			matchingStrategy: 'all',
			sort: [{ field: 'timestamp', dir: 'desc' }],
			filters: {
				from: { op: 'contains', value: '@acme.com' },
				tags: { op: 'any', value: ['x', 'y'] },
			},
		};
		const draft = fromApiSearchQuery(api);
		const back = toApiSearchQuery(draft);
		expect(back).toEqual(api);
	});

	it('drops unknown sort field on decode', () => {
		const api = {
			sort: [{ field: 'subject', dir: 'asc' }],
		} as unknown as SearchQuery;
		const draft = fromApiSearchQuery(api);
		expect(draft.sort).toEqual([]);
	});
});
