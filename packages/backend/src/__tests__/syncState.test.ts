import { describe, it, expect } from 'vitest';
import { oneLevelDeepMergeSyncState } from '../helpers/syncState';

describe('oneLevelDeepMergeSyncState', () => {
	it('keeps other google mailboxes when merging one user', () => {
		const merged = oneLevelDeepMergeSyncState(
			{ google: { 'a@example.com': { historyId: '1' } } },
			{ google: { 'b@example.com': { historyId: '2' } } }
		);

		expect(merged.google).toEqual({
			'a@example.com': { historyId: '1' },
			'b@example.com': { historyId: '2' },
		});
	});

	it('updates an existing mailbox historyId', () => {
		const merged = oneLevelDeepMergeSyncState(
			{ google: { 'a@example.com': { historyId: '1' } } },
			{ google: { 'a@example.com': { historyId: '9' } } }
		);

		expect(merged.google?.['a@example.com'].historyId).toBe('9');
	});

	it('does not replace sibling provider keys', () => {
		const merged = oneLevelDeepMergeSyncState(
			{
				google: { 'a@example.com': { historyId: '1' } },
				imap: { INBOX: { maxUid: 10 } },
			},
			{ google: { 'b@example.com': { historyId: '2' } } }
		);

		expect(merged.imap).toEqual({ INBOX: { maxUid: 10 } });
		expect(merged.google?.['a@example.com']).toEqual({ historyId: '1' });
		expect(merged.google?.['b@example.com']).toEqual({ historyId: '2' });
	});

	it('replaces top-level scalars', () => {
		const merged = oneLevelDeepMergeSyncState(
			{ lastSyncTimestamp: 'old', google: { 'a@example.com': { historyId: '1' } } },
			{ lastSyncTimestamp: 'new' }
		);

		expect(merged.lastSyncTimestamp).toBe('new');
		expect(merged.google?.['a@example.com'].historyId).toBe('1');
	});
});
