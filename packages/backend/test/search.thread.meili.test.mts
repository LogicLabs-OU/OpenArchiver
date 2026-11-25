/**
 * Integration test: the thread filter, against a real Meilisearch with the index settings the app
 * applies.
 *
 * Runs against the compiled backend (`pnpm build` first) and needs a Meilisearch it may write to.
 * It replaces the `emails` index, so never point it at a real deployment:
 *
 *   docker run -d --rm -p 7700:7700 -e MEILI_MASTER_KEY=test getmeili/meilisearch:v1.38
 *   MEILI_HOST=http://localhost:7700 MEILI_MASTER_KEY=test \
 *     pnpm --filter @open-archiver/backend test:integration:meili-thread
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

const THREADS = ['t-1', 't-2', 't-1', 'quote"d', undefined, 't-1'];

describe('thread filter', { skip: !MEILI_HOST && 'MEILI_HOST is not set' }, () => {
	let index: any;
	let buildEmailSearchFilter: (filters: object) => string | undefined;

	before(async () => {
		const { SearchService } = await import('../dist/services/SearchService.js');
		const { IndexingService } = await import('../dist/services/IndexingService.js');
		({ buildEmailSearchFilter } = await import('../dist/helpers/meiliFilter.js'));

		const service: any = new SearchService();
		const deletion = await service.client.deleteIndex('emails');
		await service.waitForTask(deletion.taskUid);
		await service.configureEmailIndex();
		index = await service.getIndex('emails');

		// Through the indexer's own normalization, so a field it drops would fail this test.
		const normalize = (IndexingService.prototype as any).normalizeEmailDocument;
		const docs = THREADS.map((threadId, i) =>
			normalize.call(
				{},
				{
					id: `e${i}`,
					userEmail: 'owner@example.com',
					from: 'a@example.com',
					subject: `email ${i}`,
					timestamp: Date.UTC(2026, 0, 10 - i),
					ingestionSourceId: 's1',
					threadId,
				}
			)
		);
		const task = await index.addDocuments(docs);
		await service.waitForTask(task.taskUid);
	});

	const ids = async (filters: object, sort = ['timestamp:asc']) => {
		const result = await index.search('', {
			filter: buildEmailSearchFilter(filters),
			sort,
			limit: 20,
		});
		return result.hits.map((h: { id: string }) => h.id).join(',');
	};

	test('the indexer keeps the thread, and leaves it out when there is none', async () => {
		assert.equal((await index.getDocument('e0')).threadId, 't-1');
		assert.equal((await index.getDocument('e4')).threadId, undefined);
	});

	test('lists one thread oldest first', async () => {
		assert.equal(await ids({ threadId: 't-1' }), 'e5,e2,e0');
	});

	test('combines with the other filters', async () => {
		assert.equal(await ids({ threadId: 't-1', dateFrom: '2026-01-08' }), 'e2,e0');
	});

	test('quotes in a thread id are escaped, not interpreted', async () => {
		assert.equal(await ids({ threadId: 'quote"d' }), 'e3');
	});

	test('an unknown thread matches nothing', async () => {
		assert.equal(await ids({ threadId: 'nope' }), '');
	});
});
