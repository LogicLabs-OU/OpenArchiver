import { describe, it, expect, vi } from 'vitest';
import { unlink } from 'fs/promises';
import type { ImapFlow } from 'imapflow';
import type { GenericImapCredentials } from '@open-archiver/types';
import { ImapConnector } from './ImapConnector';

// Fixture mailbox: three messages, one of which (uid 102) the caller reports as
// an already-archived duplicate so it must be skipped before its body is fetched.
const MESSAGES = [
	{ uid: 101, messageId: '<m1@example.com>', subject: 'Test 1' },
	{ uid: 102, messageId: '<m2@example.com>', subject: 'Test 2' },
	{ uid: 103, messageId: '<m3@example.com>', subject: 'Test 3' },
];

const rawEmail = (m: { messageId: string; subject: string }): Buffer =>
	Buffer.from(
		`From: sender@example.com\r\n` +
			`To: rcpt@example.com\r\n` +
			`Subject: ${m.subject}\r\n` +
			`Message-ID: ${m.messageId}\r\n` +
			`Date: Wed, 01 Jan 2025 00:00:00 +0000\r\n` +
			`\r\n` +
			`Body of ${m.subject}\r\n`
	);

interface Recorder {
	fetchOneCalls: string[];
	envelopeFetchRanges: unknown[];
	sourceFetchRanges: unknown[];
}

/**
 * Minimal fake ImapFlow that records how bodies are fetched. `usable` returns
 * true so the connector's connect() keeps this instance rather than building a
 * real client. `fetch()` branches on whether the query asks for `source`:
 * Pass 1 (envelopes only) yields every message; Pass 2 (with source) yields only
 * the UIDs requested in the ranged set.
 */
const makeFakeClient = (recorder: Recorder): ImapFlow =>
	({
		get usable() {
			return true;
		},
		async connect() {},
		async logout() {},
		on() {},
		async list() {
			return [{ path: 'INBOX', flags: new Set<string>(), specialUse: undefined }];
		},
		async mailboxOpen(path: string) {
			return { path, exists: MESSAGES.length };
		},
		async fetchOne(seq: string) {
			// Only used to seed the max UID from the last message in the mailbox.
			recorder.fetchOneCalls.push(seq);
			return { uid: MESSAGES[MESSAGES.length - 1].uid };
		},
		fetch(range: { uid?: string }, query: { source?: boolean }) {
			const isSource = !!query?.source;
			(isSource ? recorder.sourceFetchRanges : recorder.envelopeFetchRanges).push(range?.uid);
			async function* gen() {
				const wanted = isSource
					? String(range?.uid ?? '')
							.split(',')
							.map((s) => parseInt(s, 10))
					: null;
				for (const m of MESSAGES) {
					if (wanted && !wanted.includes(m.uid)) continue;
					yield isSource
						? { uid: m.uid, envelope: { messageId: m.messageId }, source: rawEmail(m) }
						: { uid: m.uid, envelope: { messageId: m.messageId } };
				}
			}
			return gen();
		},
	}) as unknown as ImapFlow;

const credentials: GenericImapCredentials = {
	type: 'generic_imap',
	host: 'imap.example.com',
	port: 993,
	secure: true,
	allowInsecureCert: false,
	username: 'user@example.com',
	password: 'secret',
};

describe('ImapConnector.fetchEmails batching', () => {
	it('fetches all non-duplicate message bodies in a single ranged FETCH', async () => {
		const recorder: Recorder = {
			fetchOneCalls: [],
			envelopeFetchRanges: [],
			sourceFetchRanges: [],
		};
		const connector = new ImapConnector(credentials, { preserveOriginalFile: false }, () =>
			makeFakeClient(recorder)
		);

		// uid 102 (<m2@example.com>) is reported as already archived.
		const checkDuplicate = vi.fn(async (mid: string) => mid === '<m2@example.com>');

		const collected = [];
		for await (const email of connector.fetchEmails('user@example.com', null, checkDuplicate)) {
			if (email) collected.push(email);
		}

		try {
			// THE regression guard: bodies are pulled in ONE batched FETCH over the
			// non-duplicate UID set — not one FETCH command per message.
			expect(recorder.sourceFetchRanges).toEqual(['101,103']);

			// fetchOne is used only to seed the max UID (the mailbox.exists index),
			// never to download message bodies.
			expect(recorder.fetchOneCalls).toEqual(['3']);

			// Both non-duplicates were parsed and yielded; the duplicate was skipped
			// (and never had its body fetched).
			expect(collected.map((e) => e.subject).sort()).toEqual(['Test 1', 'Test 3']);
			expect(checkDuplicate).toHaveBeenCalledTimes(MESSAGES.length);

			// Sync state advances to the highest UID observed.
			expect(connector.getUpdatedSyncState().imap?.['INBOX']?.maxUid).toBe(103);
		} finally {
			await Promise.all(collected.map((e) => unlink(e.tempFilePath).catch(() => {})));
		}
	});

	it('skips the body FETCH entirely when every message is a duplicate', async () => {
		const recorder: Recorder = {
			fetchOneCalls: [],
			envelopeFetchRanges: [],
			sourceFetchRanges: [],
		};
		const connector = new ImapConnector(credentials, { preserveOriginalFile: false }, () =>
			makeFakeClient(recorder)
		);

		const checkDuplicate = vi.fn(async () => true);

		const collected = [];
		for await (const email of connector.fetchEmails('user@example.com', null, checkDuplicate)) {
			if (email) collected.push(email);
		}

		// No non-duplicates → Pass 2 never issues a source FETCH, nothing yielded.
		expect(recorder.sourceFetchRanges).toEqual([]);
		expect(collected).toHaveLength(0);
		// Envelopes were still scanned and max UID still advances.
		expect(connector.getUpdatedSyncState().imap?.['INBOX']?.maxUid).toBe(103);
	});
});
