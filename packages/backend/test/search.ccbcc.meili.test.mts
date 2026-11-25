/**
 * Integration test: the Cc and Bcc filters, against a real Meilisearch with the index settings
 * the app applies.
 *
 * Runs against the compiled backend (`pnpm build` first) and needs a Meilisearch it may write to.
 * It replaces the `emails` index, so never point it at a real deployment:
 *
 *   docker run -d --rm -p 7700:7700 -e MEILI_MASTER_KEY=test getmeili/meilisearch:v1.38
 *   MEILI_HOST=http://localhost:7700 MEILI_MASTER_KEY=test \
 *     pnpm --filter @open-archiver/backend test:integration:meili-cc-bcc
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

const EMAILS = [
	{ to: ['ann@example.com'], cc: [], bcc: [] },
	{ to: [], cc: ['ann@example.com'], bcc: [] },
	{ to: [], cc: [], bcc: ['ann@example.com'] },
	{ to: [], cc: ['ann@example.com', 'bob@example.com'], bcc: ['carl@example.com'] },
];

describe('cc and bcc filters', { skip: !MEILI_HOST && 'MEILI_HOST is not set' }, () => {
	let index: any;
	let buildEmailSearchFilter: (filters: object) => string | undefined;

	before(async () => {
		const { SearchService } = await import('../dist/services/SearchService.js');
		({ buildEmailSearchFilter } = await import('../dist/helpers/meiliFilter.js'));

		const service: any = new SearchService();
		const deletion = await service.client.deleteIndex('emails');
		await service.waitForTask(deletion.taskUid);
		await service.configureEmailIndex();
		index = await service.getIndex('emails');

		const docs = EMAILS.map((e, i) => ({
			id: `e${i}`,
			userEmail: 'owner@example.com',
			from: 'sender@example.com',
			fromName: '',
			subject: `email ${i}`,
			body: '',
			attachments: [],
			timestamp: Date.UTC(2026, 0, i + 1),
			ingestionSourceId: 's1',
			...e,
		}));
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

	test('to still spans To, Cc and Bcc', async () => {
		assert.equal(await ids({ to: ['ann@example.com'] }), 'e0,e1,e2,e3');
	});

	test('cc checks the Cc field only', async () => {
		assert.equal(await ids({ cc: ['ann@example.com'] }), 'e1,e3');
	});

	test('bcc checks the Bcc field only', async () => {
		assert.equal(await ids({ bcc: ['ann@example.com'] }), 'e2');
		assert.equal(await ids({ bcc: ['carl@example.com'] }), 'e3');
	});

	test('several values match any of them; cc and bcc together must both hold', async () => {
		assert.equal(await ids({ cc: ['bob@example.com', 'ann@example.com'] }), 'e1,e3');
		assert.equal(await ids({ cc: ['ann@example.com'], bcc: ['carl@example.com'] }), 'e3');
	});
});

describe('cc and bcc parameters', () => {
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
		return { code: res.code, filters: captured?.filters };
	};

	test('are parsed and normalized like the other address filters', async () => {
		const { code, filters } = await call({
			cc: ' Ann@Example.com ,bob@example.com',
			bcc: 'c@x.org',
		});
		assert.equal(code, 200);
		assert.deepEqual(filters.cc, ['ann@example.com', 'bob@example.com']);
		assert.deepEqual(filters.bcc, ['c@x.org']);
	});

	test('reject wildcards, which cannot be told apart per field', async () => {
		assert.equal((await call({ cc: '*@example.com' })).code, 400);
		assert.equal((await call({ bcc: 'ann@*' })).code, 400);
	});
});
