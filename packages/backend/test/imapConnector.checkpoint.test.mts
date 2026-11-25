/**
 * Unit test: the IMAP checkpoint never moves past a message that was not handed over for archiving.
 *
 * Runs against the compiled backend (`pnpm build` first), with a fake IMAP client in place of a
 * server:
 *
 *   pnpm --filter @open-archiver/backend test:imap-checkpoint
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';

// The connector imports the app config, which refuses to load without a storage backend. Nothing
// here touches storage; these only satisfy that check. Set before the dynamic import below, since
// a static import would be evaluated first.
process.env.STORAGE_TYPE ??= 'local';
process.env.STORAGE_LOCAL_ROOT_PATH ??= tmpdir();
process.env.LOG_LEVEL ??= 'silent';

const { ImapConnector } = await import('../dist/services/ingestion-connectors/ImapConnector.js');
type ImapConnector = InstanceType<typeof ImapConnector>;

const RAW = (uid: number) =>
	Buffer.from(
		`From: a@example.com\r\nTo: b@example.com\r\nSubject: m${uid}\r\nMessage-ID: <m${uid}@example.com>\r\nDate: Mon, 2 Mar 2026 10:00:00 +0000\r\n\r\nbody ${uid}\r\n`
	);

interface FakeFolder {
	uids: number[];
	/** UIDs the full-source fetch fails for, every time. */
	failBody?: Set<number>;
	/** UIDs the envelope fetch leaves out, as if expunged after the search. */
	expunged?: Set<number>;
	/** Pass-1 order, to check the connector does not rely on the server sorting. */
	reverseEnvelopes?: boolean;
	/** Fails the whole folder at open. */
	failOpen?: boolean;
}

function fakeClient(folders: Record<string, FakeFolder>) {
	let current = '';
	return {
		usable: true,
		on() {},
		async connect() {},
		async logout() {},
		async list() {
			return Object.keys(folders).map((path) => ({ path, flags: new Set<string>() }));
		},
		async mailboxOpen(path: string) {
			if (folders[path].failOpen) throw new Error(`cannot open ${path}`);
			current = path;
			return { exists: folders[path].uids.length };
		},
		async search(query: { uid: string }) {
			const from = Number(query.uid.split(':')[0]);
			return folders[current].uids.filter((u) => u >= from);
		},
		async *fetch(batch: number[]) {
			const f = folders[current];
			const out = batch.filter((u) => !f.expunged?.has(u));
			if (f.reverseEnvelopes) out.reverse();
			for (const uid of out) {
				yield {
					uid,
					flags: new Set<string>(),
					envelope: { messageId: `<m${uid}@example.com>` },
				};
			}
		},
		async fetchOne(uid: string) {
			const n = Number(uid);
			if (folders[current].failBody?.has(n)) throw new Error('Socket timeout');
			return {
				uid: n,
				flags: new Set<string>(),
				envelope: {},
				source: RAW(n),
				internalDate: new Date('2026-03-02T10:00:00Z'),
			};
		},
	};
}

function connectorWith(folders: Record<string, FakeFolder>) {
	const connector = new ImapConnector({
		host: 'imap.example.com',
		port: 993,
		secure: true,
		username: 'user@example.com',
		password: 'x',
	} as any);
	const client = fakeClient(folders);
	// Swaps the network client for the fake; the retry/backoff wrapper is bypassed so a failing
	// fetch fails at once instead of after its backoff ladder.
	(connector as any).createClient = async () => client;
	(connector as any).withRetry = async (action: () => Promise<unknown>) => {
		await (connector as any).connect();
		return action();
	};
	return connector;
}

async function drain(
	connector: ImapConnector,
	syncState: any = null,
	isDuplicate: (id: string) => boolean = () => false
) {
	const yielded: string[] = [];
	for await (const email of connector.fetchEmails('user@example.com', syncState, async (id) =>
		isDuplicate(id)
	)) {
		if (email) yielded.push(email.subject);
	}
	return yielded;
}

const checkpoint = (c: ImapConnector, path: string) => c.getUpdatedSyncState().imap?.[path]?.maxUid;

describe('ImapConnector checkpoint', () => {
	test('a clean folder advances to its highest UID', async () => {
		const c = connectorWith({ INBOX: { uids: [3, 7, 9] } });
		assert.deepEqual(await drain(c), ['m3', 'm7', 'm9']);
		assert.equal(checkpoint(c, 'INBOX'), 9);
		assert.equal(c.getFetchFailures().count, 0);
	});

	test('a body fetch failure holds the checkpoint at the last message before it', async () => {
		// Before the fix the checkpoint was the highest envelope seen (9), so 7 and 9 were lost.
		const c = connectorWith({ INBOX: { uids: [3, 5, 7, 9], failBody: new Set([7]) } });
		assert.deepEqual(await drain(c), ['m3', 'm5']);
		assert.equal(checkpoint(c, 'INBOX'), 5);
	});

	test('the failed folder is reported, and the other folders still run', async () => {
		const c = connectorWith({
			INBOX: { uids: [1, 2], failBody: new Set([2]) },
			Archive: { uids: [4, 6] },
		});
		assert.deepEqual(await drain(c), ['m1', 'm4', 'm6']);
		assert.equal(checkpoint(c, 'INBOX'), 1);
		assert.equal(checkpoint(c, 'Archive'), 6);
		const failures = c.getFetchFailures();
		assert.equal(failures.count, 1);
		assert.match(failures.samples[0], /Folder INBOX: Socket timeout/);
	});

	test('a folder that fails to open keeps its previous checkpoint', async () => {
		const c = connectorWith({ INBOX: { uids: [10, 11], failOpen: true } });
		await drain(c, { imap: { INBOX: { maxUid: 8 } } });
		// Never selected, so never initialised: the merge keeps the stored value.
		assert.equal(checkpoint(c, 'INBOX'), undefined);
		assert.equal(c.getFetchFailures().count, 1);
	});

	test('a failure on the first new message leaves the stored checkpoint as it was', async () => {
		const c = connectorWith({ INBOX: { uids: [5, 12, 13], failBody: new Set([12]) } });
		await drain(c, { imap: { INBOX: { maxUid: 5 } } });
		assert.equal(checkpoint(c, 'INBOX'), 5);
	});

	test('duplicates and expunged UIDs do not hold the checkpoint back', async () => {
		const c = connectorWith({ INBOX: { uids: [1, 2, 3, 4], expunged: new Set([2]) } });
		const yielded = await drain(c, null, (id) => id === '<m3@example.com>');
		assert.deepEqual(yielded, ['m1', 'm4']);
		assert.equal(checkpoint(c, 'INBOX'), 4);
	});

	test('envelopes arriving out of order are still fetched lowest UID first', async () => {
		const c = connectorWith({
			INBOX: { uids: [1, 2, 3, 4], reverseEnvelopes: true, failBody: new Set([3]) },
		});
		assert.deepEqual(await drain(c), ['m1', 'm2']);
		assert.equal(checkpoint(c, 'INBOX'), 2);
	});

	test('the checkpoint is contiguous across batches of 250', async () => {
		const uids = Array.from({ length: 600 }, (_, i) => i + 1);
		const c = connectorWith({ INBOX: { uids, failBody: new Set([400]) } });
		const yielded = await drain(c);
		assert.equal(yielded.length, 399);
		assert.equal(checkpoint(c, 'INBOX'), 399);
	});

	test('ten failing folders in a row abort the run', async () => {
		const folders: Record<string, FakeFolder> = {};
		for (let i = 0; i < 10; i++) folders[`F${i}`] = { uids: [1], failOpen: true };
		const c = connectorWith(folders);
		await assert.rejects(drain(c), /consecutive failures/);
	});
});
