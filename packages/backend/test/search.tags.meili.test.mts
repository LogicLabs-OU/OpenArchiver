/**
 * Integration test: the tags filter and tag suggestions, against a real Meilisearch with the index
 * settings the app applies.
 *
 * Runs against the compiled backend (`pnpm build` first) and needs a Meilisearch it may write to.
 * It replaces the `emails` index, so never point it at a real deployment:
 *
 *   docker run -d --rm -p 7700:7700 -e MEILI_MASTER_KEY=test getmeili/meilisearch:v1.38
 *   MEILI_HOST=http://localhost:7700 MEILI_MASTER_KEY=test \
 *     pnpm --filter @open-archiver/backend test:integration:meili-tags
 *
 * Skipped when MEILI_HOST is not set.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';

const MEILI_HOST = process.env.MEILI_HOST;

// SearchService imports the app config, the database client and the services around it, which
// refuse to load without these. Nothing here touches storage or the database.
process.env.STORAGE_TYPE ??= 'local';
process.env.STORAGE_LOCAL_ROOT_PATH ??= tmpdir();
process.env.DATABASE_URL ??= 'postgres://unused@127.0.0.1:1/unused';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.LOG_LEVEL ??= 'silent';

const TAGS = [
	['Invoices'],
	['Invoices', 'Travel'],
	['Travel'],
	['Say "hi"'],
	undefined,
	['Invoices'],
];

describe('tags filter', { skip: !MEILI_HOST && 'MEILI_HOST is not set' }, () => {
	let service: any;
	let index: any;
	let buildEmailSearchFilter: (filters: object) => string | undefined;

	before(async () => {
		const { SearchService } = await import('../dist/services/SearchService.js');
		const { IndexingService } = await import('../dist/services/IndexingService.js');
		const { FilterBuilder } = await import('../dist/services/FilterBuilder.js');
		({ buildEmailSearchFilter } = await import('../dist/helpers/meiliFilter.js'));

		// The permission lookup needs the database; an admin (no restriction) is what is tested.
		(FilterBuilder as any).create = async () => ({ searchFilter: undefined });

		service = new SearchService();
		const deletion = await service.client.deleteIndex('emails');
		await service.waitForTask(deletion.taskUid);
		await service.configureEmailIndex();
		index = await service.getIndex('emails');

		// Through the indexer's own normalization, so a field it drops would fail this test.
		const normalize = (IndexingService.prototype as any).normalizeEmailDocument;
		const docs = TAGS.map((tags, i) =>
			normalize.call(
				{},
				{
					id: `e${i}`,
					userEmail: 'owner@example.com',
					from: 'a@example.com',
					subject: `email ${i}`,
					timestamp: Date.UTC(2026, 0, i + 1),
					ingestionSourceId: 's1',
					tags,
				}
			)
		);
		const task = await index.addDocuments(docs);
		await service.waitForTask(task.taskUid);
	});

	const ids = async (filters: object) => {
		const result = await index.search('', {
			filter: buildEmailSearchFilter(filters),
			sort: ['timestamp:asc'],
			limit: 20,
		});
		return result.hits.map((h: { id: string }) => h.id).join(',');
	};

	test('the indexer keeps the tags', async () => {
		assert.deepEqual((await index.getDocument('e1')).tags, ['Invoices', 'Travel']);
		assert.equal((await index.getDocument('e4')).tags, undefined);
	});

	test('one tag matches any email carrying it, ignoring case', async () => {
		assert.equal(await ids({ tags: ['Invoices'] }), 'e0,e1,e5');
		assert.equal(await ids({ tags: ['travel'] }), 'e1,e2');
	});

	test('several tags match any of them', async () => {
		assert.equal(await ids({ tags: ['Invoices', 'Travel'] }), 'e0,e1,e2,e5');
	});

	test('quotes in a tag are escaped, not interpreted', async () => {
		assert.equal(await ids({ tags: ['Say "hi"'] }), 'e3');
	});

	test('suggestions list tags by how many emails carry them', async () => {
		assert.deepEqual(await service.searchFacetValues('tags', '', 'admin'), [
			'Invoices',
			'Travel',
			'Say "hi"',
		]);
	});

	test('suggestions match the start of the tag as it is typed, ignoring case', async () => {
		assert.deepEqual(await service.searchFacetValues('tags', 'tra', 'admin'), ['Travel']);
	});
});
