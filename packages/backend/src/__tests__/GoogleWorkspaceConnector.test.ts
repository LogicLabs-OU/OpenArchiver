import { describe, it, expect, vi, beforeEach } from 'vitest';

const { messagesGetMock, messagesListMock, getProfileMock, labelsGetMock } = vi.hoisted(() => ({
	messagesGetMock: vi.fn(),
	messagesListMock: vi.fn(),
	getProfileMock: vi.fn(),
	labelsGetMock: vi.fn(),
}));

vi.mock('googleapis', () => ({
	google: {
		auth: {
			JWT: vi.fn().mockImplementation(() => ({})),
		},
		gmail: vi.fn(() => ({
			users: {
				messages: {
					get: messagesGetMock,
					list: messagesListMock,
				},
				getProfile: getProfileMock,
				labels: {
					get: labelsGetMock,
				},
			},
		})),
		admin: vi.fn(),
	},
}));

vi.mock('../services/ingestion-connectors/helpers/tempFile', () => ({
	writeEmailToTempFile: vi.fn().mockResolvedValue('/tmp/raw-email.eml'),
}));

import { GoogleWorkspaceConnector } from '../services/ingestion-connectors/GoogleWorkspaceConnector';

const credentials = {
	serviceAccountKeyJson: JSON.stringify({
		client_email: 'sa@example.com',
		private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
	}),
	impersonatedAdminEmail: 'admin@example.com',
	domain: 'example.com',
};

const metadataResponse = {
	labelIds: ['INBOX'],
	threadId: 'thread-1',
	payload: {
		headers: [
			{ name: 'Message-ID', value: '<shared@example.com>' },
			{ name: 'Subject', value: 'Shared Email' },
			{ name: 'From', value: 'Sender <sender@example.com>' },
			{ name: 'To', value: 'Recipient <recipient@example.com>' },
			{ name: 'Date', value: 'Sat, 01 Jun 2024 10:00:00 +0000' },
		],
	},
};

describe('GoogleWorkspaceConnector METADATA-before-RAW', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		getProfileMock.mockResolvedValue({ data: { historyId: '100' } });
		messagesListMock.mockResolvedValue({
			data: {
				messages: [{ id: 'gmail-msg-1' }, { id: 'gmail-msg-2' }],
			},
		});
		labelsGetMock.mockResolvedValue({ data: { name: 'INBOX', type: 'system' } });

		messagesGetMock.mockImplementation(async (params: { format?: string; id: string }) => {
			if (params.format === 'METADATA') {
				return { data: { ...metadataResponse, id: params.id } };
			}
			if (params.format === 'RAW') {
				return {
					data: {
						id: params.id,
						raw: Buffer.from('From: sender@example.com\r\n\r\nHello').toString(
							'base64url'
						),
					},
				};
			}
			return { data: {} };
		});
	});

	it('skips RAW download when group already has RFC Message-ID', async () => {
		const connector = new GoogleWorkspaceConnector(credentials);
		const checkGroupHasMessageId = vi.fn().mockReturnValue(true);
		const emails = [];

		for await (const email of connector.fetchEmails(
			'user2@example.com',
			null,
			undefined,
			checkGroupHasMessageId
		)) {
			emails.push(email);
		}

		expect(emails).toHaveLength(2);
		expect(emails[0]?.tempFilePath).toBeUndefined();
		expect(emails[0]?.headers.get('message-id')).toBe('<shared@example.com>');
		expect(checkGroupHasMessageId).toHaveBeenCalledWith('<shared@example.com>');

		const rawCalls = messagesGetMock.mock.calls.filter((call) => call[0]?.format === 'RAW');
		expect(rawCalls).toHaveLength(0);
	});

	it('downloads RAW when RFC Message-ID is not yet in group', async () => {
		const connector = new GoogleWorkspaceConnector(credentials);
		const checkGroupHasMessageId = vi.fn().mockReturnValue(false);
		const emails = [];

		for await (const email of connector.fetchEmails(
			'user1@example.com',
			null,
			undefined,
			checkGroupHasMessageId
		)) {
			emails.push(email);
		}

		expect(emails).toHaveLength(2);
		expect(emails[0]?.tempFilePath).toBe('/tmp/raw-email.eml');

		const rawCalls = messagesGetMock.mock.calls.filter((call) => call[0]?.format === 'RAW');
		expect(rawCalls).toHaveLength(2);
	});

	it('falls back to RAW when METADATA has no Message-ID header', async () => {
		messagesGetMock.mockImplementation(async (params: { format?: string; id: string }) => {
			if (params.format === 'METADATA') {
				return {
					data: {
						labelIds: ['INBOX'],
						id: params.id,
						payload: {
							headers: [{ name: 'Subject', value: 'No Message-ID' }],
						},
					},
				};
			}
			if (params.format === 'RAW') {
				return {
					data: {
						id: params.id,
						raw: Buffer.from('Subject: No Message-ID\r\n\r\nHello').toString(
							'base64url'
						),
					},
				};
			}
			return { data: {} };
		});

		const connector = new GoogleWorkspaceConnector(credentials);
		const checkGroupHasMessageId = vi.fn().mockReturnValue(true);
		const emails = [];

		for await (const email of connector.fetchEmails(
			'user3@example.com',
			null,
			undefined,
			checkGroupHasMessageId
		)) {
			emails.push(email);
		}

		expect(checkGroupHasMessageId).not.toHaveBeenCalled();
		const rawCalls = messagesGetMock.mock.calls.filter((call) => call[0]?.format === 'RAW');
		expect(rawCalls).toHaveLength(2);
		expect(emails[0]?.tempFilePath).toBe('/tmp/raw-email.eml');
	});

	it('parses metadata-only addresses via simpleParser (quoted names with commas)', async () => {
		messagesGetMock.mockImplementation(async (params: { format?: string; id: string }) => {
			if (params.format === 'METADATA') {
				return {
					data: {
						id: params.id,
						labelIds: ['INBOX'],
						payload: {
							headers: [
								{ name: 'Message-ID', value: '<shared@example.com>' },
								{
									name: 'From',
									value: '"Mustermann, GmbH" <sender@example.com>',
								},
								{ name: 'To', value: 'Recipient <recipient@example.com>' },
							],
						},
					},
				};
			}
			throw new Error('RAW should not be fetched');
		});

		const connector = new GoogleWorkspaceConnector(credentials);
		const emails = [];

		for await (const email of connector.fetchEmails(
			'user@example.com',
			null,
			undefined,
			() => true
		)) {
			emails.push(email);
		}

		expect(emails[0]?.from[0]).toEqual({
			name: 'Mustermann, GmbH',
			address: 'sender@example.com',
		});
		expect(emails[0]?.tempFilePath).toBeUndefined();
	});
});
