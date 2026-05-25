import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSearchEmails = vi.fn();

vi.mock('../../services/SearchService', () => ({
	SearchService: vi.fn().mockImplementation(() => ({
		searchEmails: mockSearchEmails,
	})),
}));

import { SearchController } from './search.controller';
import { FilterValidationError } from '../../services/search/filterTranslator';

type AnyRequest = {
	user?: { sub?: string };
	ip?: string;
	body?: unknown;
	query?: Record<string, string | undefined>;
	t: (key: string, opts?: Record<string, unknown>) => string;
};

interface MockResponse {
	statusCode: number;
	body: unknown;
	headers: Record<string, string>;
	status: (code: number) => MockResponse;
	json: (body: unknown) => MockResponse;
	setHeader: (name: string, value: string) => MockResponse;
}

function makeRes(): MockResponse {
	const res: MockResponse = {
		statusCode: 0,
		body: undefined,
		headers: {},
		status(code: number) {
			res.statusCode = code;
			return res;
		},
		json(body: unknown) {
			res.body = body;
			return res;
		},
		setHeader(name: string, value: string) {
			res.headers[name] = value;
			return res;
		},
	};
	return res;
}

function makeReq(overrides: Partial<AnyRequest> = {}): AnyRequest {
	return {
		user: { sub: 'user-1' },
		ip: '127.0.0.1',
		body: {},
		query: {},
		t: (key, opts) =>
			opts ? `${key}:${JSON.stringify(opts)}` : key,
		...overrides,
	};
}

const okResult = {
	hits: [],
	total: 0,
	page: 1,
	limit: 10,
	totalPages: 0,
	processingTimeMs: 1,
};

describe('SearchController', () => {
	let controller: SearchController;

	beforeEach(() => {
		mockSearchEmails.mockReset();
		mockSearchEmails.mockResolvedValue(okResult);
		controller = new SearchController();
	});

	describe('searchPost', () => {
		it('applies defaults when body is empty', async () => {
			const req = makeReq({ body: {} });
			const res = makeRes();
			await controller.searchPost(req as never, res as never);
			expect(res.statusCode).toBe(200);
			expect(mockSearchEmails).toHaveBeenCalledTimes(1);
			const [dto] = mockSearchEmails.mock.calls[0];
			expect(dto).toEqual({});
		});

		it('forwards filter-only body without 400', async () => {
			const req = makeReq({
				body: { filters: { from: { op: 'eq', value: 'a@x.com' } } },
			});
			const res = makeRes();
			await controller.searchPost(req as never, res as never);
			expect(res.statusCode).toBe(200);
			const [dto] = mockSearchEmails.mock.calls[0];
			expect(dto.filters).toEqual({ from: { op: 'eq', value: 'a@x.com' } });
			expect(dto.query).toBeUndefined();
		});

		it('rejects unknown top-level keys with 400', async () => {
			const req = makeReq({
				body: { filters: {}, evil: true },
			});
			const res = makeRes();
			await controller.searchPost(req as never, res as never);
			expect(res.statusCode).toBe(400);
		});

		it('rejects unknown filter keys with 400', async () => {
			const req = makeReq({
				body: { filters: { fake: 'x' } },
			});
			const res = makeRes();
			await controller.searchPost(req as never, res as never);
			expect(res.statusCode).toBe(400);
		});

		it('returns 401 when no user is attached', async () => {
			const req = makeReq({ user: undefined, body: {} });
			const res = makeRes();
			await controller.searchPost(req as never, res as never);
			expect(res.statusCode).toBe(401);
		});

		it('maps FilterValidationError from service to 400 with field/reason', async () => {
			mockSearchEmails.mockRejectedValueOnce(
				new FilterValidationError('subject', 'unknown field')
			);
			const req = makeReq({ body: {} });
			const res = makeRes();
			await controller.searchPost(req as never, res as never);
			expect(res.statusCode).toBe(400);
			expect(res.body).toMatchObject({
				field: 'subject',
				reason: 'unknown field',
			});
		});
	});

	describe('searchGet (deprecated)', () => {
		it('returns 200 with no keywords (regression #288)', async () => {
			const req = makeReq({ query: {} });
			const res = makeRes();
			await controller.searchGet(req as never, res as never);
			expect(res.statusCode).toBe(200);
			const [dto] = mockSearchEmails.mock.calls[0];
			expect(dto.query).toBe('');
		});

		it('passes keywords through when provided', async () => {
			const req = makeReq({ query: { keywords: 'invoice' } });
			const res = makeRes();
			await controller.searchGet(req as never, res as never);
			expect(res.statusCode).toBe(200);
			const [dto] = mockSearchEmails.mock.calls[0];
			expect(dto.query).toBe('invoice');
		});

		it('sets Deprecation: true header', async () => {
			const req = makeReq({ query: {} });
			const res = makeRes();
			await controller.searchGet(req as never, res as never);
			expect(res.headers['Deprecation']).toBe('true');
			expect(typeof res.headers['Sunset']).toBe('string');
			// Sunset must be a valid future ISO date.
			const sunset = new Date(res.headers['Sunset']);
			expect(sunset.getTime()).toBeGreaterThan(Date.now());
		});

		it('coerces numeric query params', async () => {
			const req = makeReq({ query: { keywords: 'x', page: '2', limit: '25' } });
			const res = makeRes();
			await controller.searchGet(req as never, res as never);
			expect(res.statusCode).toBe(200);
			const [dto] = mockSearchEmails.mock.calls[0];
			expect(dto.page).toBe(2);
			expect(dto.limit).toBe(25);
		});

		it('returns 401 when no user is attached', async () => {
			const req = makeReq({ user: undefined, query: {} });
			const res = makeRes();
			await controller.searchGet(req as never, res as never);
			expect(res.statusCode).toBe(401);
		});
	});
});
