/**
 * Integration test: sorting and filtering by email size, against a real Meilisearch with the index
 * settings the app applies.
 *
 * Runs against the compiled backend (`pnpm build` first) and needs a Meilisearch it may write to.
 * It replaces the `emails` index, so never point it at a real deployment:
 *
 *   docker run -d --rm -p 7700:7700 -e MEILI_MASTER_KEY=test getmeili/meilisearch:v1.38
 *   MEILI_HOST=http://localhost:7700 MEILI_MASTER_KEY=test \
 *     pnpm --filter @open-archiver/backend test:integration:meili-size
 *
 * The Meilisearch part is skipped when MEILI_HOST is not set.
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

// e4 stands for an email indexed before the size field existed.
const SIZES = [5_000, 2_000_000, 300, 2_000_000, undefined];

describe('size sort and filter', { skip: !MEILI_HOST && 'MEILI_HOST is not set' }, () => {
	let index: any;
	let rules: Record<string, string[] | undefined>;
	let buildEmailSearchFilter: (filters: object) => string | undefined;

	before(async () => {
		const { SearchService } = await import('../dist/services/SearchService.js');
		const { IndexingService } = await import('../dist/services/IndexingService.js');
		({ buildEmailSearchFilter } = await import('../dist/helpers/meiliFilter.js'));
		rules = (SearchService as any).SORT_RULES;

		const service: any = new SearchService();
		const deletion = await service.client.deleteIndex('emails');
		await service.waitForTask(deletion.taskUid);
		await service.configureEmailIndex();
		index = await service.getIndex('emails');

		// Through the indexer's own normalization, so a field it drops would fail this test.
		const normalize = (IndexingService.prototype as any).normalizeEmailDocument;
		const docs = SIZES.map((sizeBytes, i) =>
			normalize.call(
				{},
				{
					id: `e${i}`,
					userEmail: 'owner@example.com',
					from: 'a@example.com',
					subject: `email ${i}`,
					timestamp: Date.UTC(2026, 0, i + 1),
					ingestionSourceId: 's1',
					sizeBytes,
				}
			)
		);
		const task = await index.addDocuments(docs);
		await service.waitForTask(task.taskUid);
	});

	const ids = async (filters: object, sort?: string) => {
		const result = await index.search('', {
			filter: buildEmailSearchFilter(filters),
			sort: sort ? rules[sort] : ['timestamp:asc'],
			limit: 20,
		});
		return result.hits.map((h: { id: string }) => h.id).join(',');
	};

	test('the indexer keeps the size', async () => {
		assert.equal((await index.getDocument('e1')).sizeBytes, 2_000_000);
		assert.equal((await index.getDocument('e4')).sizeBytes, undefined);
	});

	test('largest first, newest first among equal sizes, unsized emails last', async () => {
		assert.equal(await ids({}, 'size_desc'), 'e3,e1,e0,e2,e4');
	});

	test('smallest first, unsized emails still last', async () => {
		assert.equal(await ids({}, 'size_asc'), 'e2,e0,e3,e1,e4');
	});

	test('bounds are inclusive and leave out unsized emails', async () => {
		assert.equal(await ids({ minSize: 5_000 }), 'e0,e1,e3');
		assert.equal(await ids({ maxSize: 5_000 }), 'e0,e2');
		assert.equal(await ids({ minSize: 1_000, maxSize: 10_000 }), 'e0');
	});
});

describe('size parameters', () => {
	const call = async (query: Record<string, string>) => {
		const { SearchController } = await import('../dist/api/controllers/search.controller.js');
		const controller: any = new SearchController();
		let captured: any;
		controller.searchService = {
			searchEmails: async (dto: any) => {
				captured = dto;
				return { hits: [] };
			},
		};
		const res: any = {
			code: 200,
			status(code: number) {
				this.code = code;
				return this;
			},
			json(body: unknown) {
				this.body = body;
				return this;
			},
		};
		await controller.search({ query, user: { sub: 'u' }, t: (k: string) => k, ip: '' }, res);
		return { code: res.code, dto: captured };
	};

	test('are parsed as whole bytes', async () => {
		const { code, dto } = await call({ minSize: '1048576', maxSize: '0' });
		assert.equal(code, 400, 'min above max');
		const ok = await call({ minSize: '0', maxSize: '1048576', sort: 'size_desc' });
		assert.equal(ok.code, 200);
		assert.deepEqual([ok.dto.filters.minSize, ok.dto.filters.maxSize], [0, 1048576]);
		assert.equal(ok.dto.sort, 'size_desc');
		assert.equal(dto, undefined);
	});

	test('reject anything that is not a whole number of bytes', async () => {
		for (const bad of ['-1', '1.5', '10MB', '', '1e6']) {
			assert.equal((await call({ minSize: bad })).code, 400, `minSize=${bad}`);
		}
	});
});
