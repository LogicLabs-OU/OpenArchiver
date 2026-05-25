import { Request, Response } from 'express';
import { z } from 'zod';
import { SearchService } from '../../services/SearchService';
import { FilterValidationError } from '../../services/search/filterTranslator';
import type { SearchQuery } from '@open-archiver/types';

const matchingStrategySchema = z.enum(['last', 'all', 'frequency']);

const sortClauseSchema = z.object({
	field: z.literal('timestamp'),
	dir: z.enum(['asc', 'desc']),
});

/**
 * Filters are validated structurally by zod (loose check — must be an object
 * with no unknown top-level keys) and then by the translator (strict op/kind
 * check + escaping). zod keeps unknown keys out; the translator decides what
 * the operator/value shape means.
 *
 * `passthrough()` on the nested per-field clause is intentional: we let the
 * translator do the discriminated-union validation since it already enumerates
 * the allowed ops per kind and produces structured errors.
 */
const filterClauseSchema = z.any();

const searchFiltersSchema = z
	.object({
		from: filterClauseSchema.optional(),
		to: filterClauseSchema.optional(),
		cc: filterClauseSchema.optional(),
		bcc: filterClauseSchema.optional(),
		subject: filterClauseSchema.optional(),
		timestamp: filterClauseSchema.optional(),
		ingestionSourceId: filterClauseSchema.optional(),
		userEmail: filterClauseSchema.optional(),
		path: filterClauseSchema.optional(),
		hasAttachments: filterClauseSchema.optional(),
		tags: filterClauseSchema.optional(),
		sizeBytes: filterClauseSchema.optional(),
		isOnLegalHold: filterClauseSchema.optional(),
		threadId: filterClauseSchema.optional(),
		attachments: z
			.object({
				sha256: filterClauseSchema.optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

const searchBodySchema = z
	.object({
		query: z.string().optional(),
		filters: searchFiltersSchema.optional(),
		sort: z.array(sortClauseSchema).optional(),
		page: z.number().int().positive().optional(),
		limit: z.number().int().positive().max(100).optional(),
		matchingStrategy: matchingStrategySchema.optional(),
	})
	.strict();

const searchQuerySchema = z.object({
	keywords: z.string().optional(),
	page: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().positive().max(100).optional(),
	matchingStrategy: matchingStrategySchema.optional(),
});

/**
 * Compute a Sunset date 6 months from today (RFC 8594). The header is
 * dynamic-by-design so we don't ship a string that's wrong the moment the PR
 * lands.
 */
function sunsetDate(now: Date = new Date()): string {
	const sunset = new Date(now);
	sunset.setMonth(sunset.getMonth() + 6);
	return sunset.toISOString();
}

export class SearchController {
	private searchService: SearchService;

	constructor() {
		this.searchService = new SearchService();
	}

	private executeSearch = async (
		dto: SearchQuery,
		req: Request,
		res: Response
	): Promise<void> => {
		try {
			const userId = req.user?.sub;
			if (!userId) {
				res.status(401).json({ message: req.t('errors.unauthorized') });
				return;
			}

			const results = await this.searchService.searchEmails(
				dto,
				userId,
				req.ip || 'unknown'
			);
			res.status(200).json(results);
		} catch (error) {
			if (error instanceof FilterValidationError) {
				res.status(400).json({
					message: req.t('search.filterInvalid', { detail: error.reason }),
					field: error.field,
					reason: error.reason,
				});
				return;
			}
			if (error instanceof z.ZodError) {
				res.status(400).json({
					message: req.t('api.requestBodyInvalid'),
					errors: error.issues,
				});
				return;
			}
			const message = error instanceof Error ? error.message : req.t('errors.unknown');
			res.status(500).json({ message });
		}
	};

	public searchPost = async (req: Request, res: Response): Promise<void> => {
		let dto: SearchQuery;
		try {
			dto = searchBodySchema.parse(req.body ?? {}) as SearchQuery;
		} catch (error) {
			if (error instanceof z.ZodError) {
				res.status(400).json({
					message: req.t('api.requestBodyInvalid'),
					errors: error.issues,
				});
				return;
			}
			throw error;
		}
		await this.executeSearch(dto, req, res);
	};

	/**
	 * Backwards-compatible GET shim. Treats missing/empty `keywords` as
	 * `query: ''` (filter-only search) rather than returning a 400 — that 400
	 * was the bug fixed in #288. Sets `Deprecation: true` + `Sunset` headers
	 * (RFC 8594) to signal the GET form will be removed.
	 */
	public searchGet = async (req: Request, res: Response): Promise<void> => {
		res.setHeader('Deprecation', 'true');
		res.setHeader('Sunset', sunsetDate());

		let parsed: z.infer<typeof searchQuerySchema>;
		try {
			parsed = searchQuerySchema.parse(req.query);
		} catch (error) {
			if (error instanceof z.ZodError) {
				res.status(400).json({
					message: req.t('api.requestBodyInvalid'),
					errors: error.issues,
				});
				return;
			}
			throw error;
		}

		const dto: SearchQuery = {
			query: parsed.keywords ?? '',
			page: parsed.page,
			limit: parsed.limit,
			matchingStrategy: parsed.matchingStrategy,
		};
		await this.executeSearch(dto, req, res);
	};
}
