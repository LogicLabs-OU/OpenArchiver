import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { LocalFileSystemProvider } from '../services/storage/LocalFileSystemProvider';

vi.mock('fs', async () => {
	const actual = await vi.importActual<typeof import('fs')>('fs');
	return {
		...actual,
		promises: {
			mkdir: vi.fn().mockResolvedValue(undefined),
			writeFile: vi.fn().mockResolvedValue(undefined),
			access: vi.fn().mockResolvedValue(undefined),
			rm: vi.fn().mockResolvedValue(undefined),
		},
	};
});

describe('LocalFileSystemProvider — mkdir caching (Change 4)', () => {
	let provider: LocalFileSystemProvider;

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new LocalFileSystemProvider({ type: 'local', rootPath: '/data' });
	});

	it('calls mkdir on first put to a new directory', async () => {
		await provider.put('emails/INBOX/msg1.eml', Buffer.from('content'));

		expect(fs.mkdir).toHaveBeenCalledTimes(1);
		expect(fs.mkdir).toHaveBeenCalledWith('/data/emails/INBOX', { recursive: true });
		expect(fs.writeFile).toHaveBeenCalledTimes(1);
	});

	it('skips mkdir on subsequent puts to the same directory', async () => {
		await provider.put('emails/INBOX/msg1.eml', Buffer.from('a'));
		await provider.put('emails/INBOX/msg2.eml', Buffer.from('b'));
		await provider.put('emails/INBOX/msg3.eml', Buffer.from('c'));

		expect(fs.mkdir).toHaveBeenCalledTimes(1);
		expect(fs.writeFile).toHaveBeenCalledTimes(3);
	});

	it('calls mkdir again when writing to a different directory', async () => {
		await provider.put('emails/INBOX/msg1.eml', Buffer.from('a'));
		await provider.put('emails/Sent/msg1.eml', Buffer.from('b'));

		expect(fs.mkdir).toHaveBeenCalledTimes(2);
		expect(fs.mkdir).toHaveBeenCalledWith('/data/emails/INBOX', { recursive: true });
		expect(fs.mkdir).toHaveBeenCalledWith('/data/emails/Sent', { recursive: true });
	});

	it('handles multiple distinct directories with one mkdir each', async () => {
		const dirs = ['INBOX', 'Sent', 'Drafts', 'Archive'];
		for (const dir of dirs) {
			await provider.put(`emails/${dir}/msg.eml`, Buffer.from('x'));
		}

		expect(fs.mkdir).toHaveBeenCalledTimes(4);

		for (const dir of dirs) {
			await provider.put(`emails/${dir}/msg2.eml`, Buffer.from('y'));
		}

		expect(fs.mkdir).toHaveBeenCalledTimes(4);
	});

	it('cache is per provider instance', async () => {
		const provider2 = new LocalFileSystemProvider({ type: 'local', rootPath: '/data' });

		await provider.put('emails/INBOX/msg1.eml', Buffer.from('a'));
		await provider2.put('emails/INBOX/msg1.eml', Buffer.from('a'));

		expect(fs.mkdir).toHaveBeenCalledTimes(2);
	});
});
