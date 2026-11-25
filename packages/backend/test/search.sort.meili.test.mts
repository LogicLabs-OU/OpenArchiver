/**
 * Integration test: every search sort option orders results as labelled, against a real
 * Meilisearch with the index settings the app applies.
 *
 * Runs against the compiled backend (`pnpm build` first) and needs a Meilisearch it may write to.
 * It replaces the `emails` index, so never point it at a real deployment:
 *
 *   docker run -d --rm -p 7700:7700 -e MEILI_MASTER_KEY=test getmeili/meilisearch:v1.38
 *   MEILI_HOST=http://localhost:7700 MEILI_MASTER_KEY=test \
 *     pnpm --filter @open-archiver/backend test:integration:meili-sort
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

const day = (n: number) => Date.UTC(2026, 0, n);

const DOCS = [
	{ id: 'a', from: 'carol@example.com', subject: 'banana', timestamp: day(1) },
	{ id: 'b', from: 'alice@example.com', subject: 'Cherry', timestamp: day(2) },
	{ id: 'c', from: 'bob@example.com', subject: 'apple', timestamp: day(3) },
	{ id: 'd', from: 'alice@example.com', subject: 'apple', timestamp: day(4) },
].map((d) => ({
	...d,
	userEmail: 'owner@example.com',
	fromName: '',
	to: [],
	cc: [],
	bcc: [],
	body: '',
	attachments: [],
	ingestionSourceId: 's1',
}));

describe('search sort options', { skip: !MEILI_HOST && 'MEILI_HOST is not set' }, () => {
	let index: any;
	let rules: Record<string, string[] | undefined>;

	before(async () => {
		const { SearchService } = await import('../dist/services/SearchService.js');
		const service = new SearchService();
		rules = (SearchService as any).SORT_RULES;

		// A fresh index each run, so settings or documents from a previous run cannot leak in.
		const deletion = await (service as any).client.deleteIndex('emails');
		await service.waitForTask(deletion.taskUid);
		await service.configureEmailIndex();
		index = await service.getIndex('emails');

		// configureEmailIndex only queues the settings update. Meilisearch runs an index's tasks in
		// order, so once the documents are in, the settings are applied too.
		const task = await index.addDocuments(DOCS);
		await service.waitForTask(task.taskUid);
		const settings = await index.getSettings();
		assert.deepEqual(settings.sortableAttributes?.sort(), ['from', 'subject', 'timestamp']);
	});

	const order = async (option: string) => {
		const result = await index.search('', { sort: rules[option], limit: 10 });
		return result.hits.map((h: { id: string }) => h.id).join('');
	};

	test('date_desc and date_asc sort by sent date', async () => {
		assert.equal(await order('date_desc'), 'dcba');
		assert.equal(await order('date_asc'), 'abcd');
	});

	test('sender sorts by address, newest first among the same sender', async () => {
		assert.equal(await order('sender_asc'), 'dbca');
		assert.equal(await order('sender_desc'), 'acdb');
	});

	test('subject sorts ignoring case, newest first among equal subjects', async () => {
		assert.equal(await order('subject_asc'), 'dcab');
		assert.equal(await order('subject_desc'), 'badc');
	});

	test('relevance applies no sort', () => {
		assert.equal(rules.relevance, undefined);
	});
});
