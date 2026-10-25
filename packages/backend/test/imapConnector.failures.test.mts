/**
 * Unit test: ImapConnector must not persist a maxUid past messages it failed to download.
 *
 * Runs against the compiled backend with a stub IMAP client, no server needed:
 *
 *   pnpm --filter @open-archiver/backend build
 *   node --test packages/backend/test/imapConnector.failures.test.mts
 *
 * The stub replaces the connector's ImapFlow client, and withRetry is reduced to a single attempt
 * so a permanent failure surfaces immediately instead of after the backoff ladder.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// The config modules validate these on import; the connector itself touches neither.
process.env.STORAGE_TYPE ??= 'local';
process.env.STORAGE_LOCAL_ROOT_PATH ??= tmpdir();
const { ImapConnector } = await import('../dist/services/ingestion-connectors/ImapConnector.js');

const MESSAGE_COUNT = 300; // more than one 250-UID batch

function rawEmail(uid: number): Buffer {
	return Buffer.from(
		[
			`Message-ID: <msg-${uid}@test.local>`,
			'From: Sender <sender@test.local>',
			'To: user@test.local',
			`Subject: Message ${uid}`,
			'Date: Sun, 25 Oct 2026 12:00:00 +0000',
			'',
			`Body ${uid}`,
			'',
		].join('\r\n')
	);
}

interface StubOptions {
	/** fetchOne rejects for these UIDs on every attempt. */
	failFetchOne?: Set<number>;
	/** The pass-1 envelope fetch rejects when its batch contains this UID. */
	failEnvelopeBatchWith?: number;
}

function stubClient(opts: StubOptions) {
	const uids = Array.from({ length: MESSAGE_COUNT }, (_, i) => i + 1);
	const envelope = (uid: number) => ({ messageId: `<msg-${uid}@test.local>` });
	return {
		usable: true,
		async list() {
			return [{ path: 'INBOX', flags: new Set<string>() }];
		},
		async mailboxOpen() {
			return { exists: uids.length };
		},
		async search(query: { uid: string }) {
			const from = Number(query.uid.split(':')[0]);
			return uids.filter((u) => u >= from);
		},
		async *fetch(batch: number[]) {
			if (opts.failEnvelopeBatchWith && batch.includes(opts.failEnvelopeBatchWith)) {
				throw new Error('Connection not available');
			}
			for (const uid of batch) {
				yield { uid, envelope: envelope(uid), flags: new Set<string>() };
			}
		},
		async fetchOne(uid: string) {
			const n = Number(uid);
			if (opts.failFetchOne?.has(n)) {
				throw new Error('Connection not available');
			}
			return {
				uid: n,
				envelope: envelope(n),
				source: rawEmail(n),
				flags: new Set<string>(),
				internalDate: new Date('2026-10-25T12:00:00Z'),
			};
		},
		async logout() {},
	};
}

async function run(opts: StubOptions, syncState: any = null) {
	const connector: any = new ImapConnector({
		type: 'generic_imap',
		host: 'imap.test.local',
		port: 993,
		secure: true,
		allowInsecureCert: false,
		username: 'user@test.local',
		password: 'x',
	});
	connector.client = stubClient(opts);
	connector.withRetry = (action: () => Promise<unknown>) => action();

	const archivedUids: number[] = [];
	for await (const email of connector.fetchEmails('user@test.local', syncState)) {
		if (email) {
			archivedUids.push(Number(/msg-(\d+)@/.exec(email.id)![1]));
			await rm(email.tempFilePath, { force: true });
		}
	}
	return {
		archivedUids,
		failures: connector.getFetchFailures?.() ?? { count: 0, samples: [] },
		syncState: connector.getUpdatedSyncState(),
	};
}

describe('ImapConnector fetch failures', () => {
	test('a message that fails to download is reported, the rest of the mailbox continues', async () => {
		const { archivedUids, failures } = await run({ failFetchOne: new Set([100]) });

		assert.equal(archivedUids.length, MESSAGE_COUNT - 1);
		assert.ok(!archivedUids.includes(100));
		// Reported failures make process-mailbox discard this run's sync state, so UID 100 is
		// retried next cycle instead of being skipped behind the advanced maxUid.
		assert.equal(failures.count, 1);
		assert.match(failures.samples[0], /INBOX UID 100/);
	});

	test('a connection lost during downloads does not leave an advanced maxUid behind', async () => {
		// Pass 1 of the second batch has already advanced the marker to 300 when every download
		// from UID 260 on fails. Before the fix the mailbox catch swallowed this, the run looked
		// successful and maxUid 300 was saved, so UIDs 260-300 were never archived.
		const failFetchOne = new Set(Array.from({ length: 41 }, (_, i) => 260 + i));
		const connector = run({ failFetchOne }, { imap: { INBOX: { maxUid: 0 } } });

		// Ten consecutive failures abort the mailbox; process-mailbox reports it as failed and
		// does not save the sync state.
		await assert.rejects(connector, /consecutive failures/);
	});

	test('a mailbox that fails mid-way keeps its previous maxUid', async () => {
		const previous = { imap: { INBOX: { maxUid: 0 } } };
		const { archivedUids, failures, syncState } = await run(
			{ failEnvelopeBatchWith: 260 },
			previous
		);

		// The first batch (UIDs 1-250) was archived, the second failed before any download.
		assert.equal(archivedUids.length, 250);
		assert.equal(failures.count, 1);
		assert.equal(syncState.imap.INBOX.maxUid, 0);
	});

	test('a clean run advances maxUid and reports no failures', async () => {
		const { archivedUids, failures, syncState } = await run({});

		assert.equal(archivedUids.length, MESSAGE_COUNT);
		assert.equal(failures.count, 0);
		assert.equal(syncState.imap.INBOX.maxUid, MESSAGE_COUNT);
	});
});
