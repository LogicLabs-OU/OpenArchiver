/**
 * Settings-shape smoke test for SearchService.configureEmailIndex.
 *
 * We do not stand up a real Meilisearch instance; instead we stub the SDK
 * client and assert the exact arrays passed to `updateSettings`. This pins the
 * P3 surface so an accidental edit (typo, dropped field) gets caught by CI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateSettings = vi.fn(async () => ({ taskUid: 1 }));
const indexStub = {
	updateSettings,
	search: vi.fn(),
	update: vi.fn(),
	addDocuments: vi.fn(),
	deleteDocuments: vi.fn(),
};

vi.mock('meilisearch', () => ({
	MeiliSearch: vi.fn().mockImplementation(() => ({
		index: vi.fn(() => indexStub),
	})),
}));

import { SearchService } from './SearchService';

describe('SearchService.configureEmailIndex', () => {
	beforeEach(() => {
		updateSettings.mockClear();
	});

	it('declares the expected P3 filterable/sortable/searchable surface', async () => {
		const svc = new SearchService();
		await svc.configureEmailIndex();

		expect(updateSettings).toHaveBeenCalledTimes(1);
		const settings = updateSettings.mock.calls[0][0];

		expect(settings.searchableAttributes).toEqual([
			'subject',
			'body',
			'from',
			'to',
			'cc',
			'bcc',
			'attachments.filename',
			'attachments.content',
			'userEmail',
			'path',
			'tags',
		]);

		expect(settings.filterableAttributes).toEqual([
			'from',
			'to',
			'cc',
			'bcc',
			'timestamp',
			'ingestionSourceId',
			'userEmail',
			'subject',
			'path',
			'tags',
			'hasAttachments',
			'sizeBytes',
			'isOnLegalHold',
			'threadId',
			'attachments.sha256',
		]);

		expect(settings.sortableAttributes).toEqual([
			'timestamp',
			'subject',
			'sizeBytes',
			'from',
		]);

		// Folded-in PR #363 fix: raise the per-facet cap above the default 100.
		expect(settings.faceting).toEqual({ maxValuesPerFacet: 10000 });
	});
});
