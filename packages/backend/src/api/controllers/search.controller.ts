import { Request, Response } from 'express';
import { SearchService } from '../../services/SearchService';
import { MatchingStrategies } from 'meilisearch';
import type { SearchFilters, SearchScope, SearchSortOption } from '@open-archiver/types';

const SEARCH_SCOPES: SearchScope[] = [
	'subject',
	'body',
	'attachment_name',
	'attachment_content',
	'from',
	'to',
];
const FACET_FIELDS = ['mailboxes', 'from'];
const SORT_OPTIONS: SearchSortOption[] = ['relevance', 'date_desc', 'date_asc'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Splits a comma-separated query param into trimmed, non-empty values. */
const csv = (value: unknown): string[] | undefined => {
	if (typeof value !== 'string' || value.trim() === '') return undefined;
	const values = value
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);
	return values.length > 0 ? values : undefined;
};

const isValidDate = (value: string): boolean => {
	if (!DATE_PATTERN.test(value)) return false;
	const ts = Date.parse(`${value}T00:00:00.000Z`);
	if (Number.isNaN(ts)) return false;
	// Date.parse rolls overflow days over (e.g. Feb 30 -> Mar 2); reject those by
	// requiring the parsed date to round-trip to the exact input.
	return new Date(ts).toISOString().slice(0, 10) === value;
};

export class SearchController {
	private searchService: SearchService;

	constructor() {
		this.searchService = new SearchService();
	}

	public search = async (req: Request, res: Response): Promise<void> => {
		try {
			const { keywords, page, limit, matchingStrategy } = req.query;
			const userId = req.user?.sub;

			if (!userId) {
				res.status(401).json({ message: req.t('errors.unauthorized') });
				return;
			}

			// --- Structured advanced-search filters ---
			const filters: SearchFilters = {};
			const sources = csv(req.query.sources);
			const excludeSources = csv(req.query.excludeSources);
			for (const ids of [sources, excludeSources]) {
				if (ids && ids.some((id) => !UUID_PATTERN.test(id))) {
					res.status(400).json({ message: req.t('search.invalidSourceId') });
					return;
				}
			}
			if (sources) filters.sources = sources;
			if (excludeSources) filters.excludeSources = excludeSources;

			const from = csv(req.query.from);
			const notFrom = csv(req.query.notFrom);
			const to = csv(req.query.to);
			const notTo = csv(req.query.notTo);
			const mailboxes = csv(req.query.mailboxes);
			if (from) filters.from = from;
			if (notFrom) filters.notFrom = notFrom;
			if (to) filters.to = to;
			if (notTo) filters.notTo = notTo;
			if (mailboxes) filters.mailboxes = mailboxes;

			const dateFrom =
				typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
			const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
			for (const date of [dateFrom, dateTo]) {
				if (date && !isValidDate(date)) {
					res.status(400).json({ message: req.t('search.invalidDate') });
					return;
				}
			}
			if (dateFrom && dateTo && dateFrom > dateTo) {
				res.status(400).json({ message: req.t('search.invalidDateRange') });
				return;
			}
			if (dateFrom) filters.dateFrom = dateFrom;
			if (dateTo) filters.dateTo = dateTo;

			const hasAttachmentsParam = req.query.hasAttachments;
			if (hasAttachmentsParam !== undefined) {
				if (hasAttachmentsParam !== 'true' && hasAttachmentsParam !== 'false') {
					res.status(400).json({ message: req.t('search.invalidParam') });
					return;
				}
				filters.hasAttachments = hasAttachmentsParam === 'true';
			}

			const searchIn = csv(req.query.searchIn) as SearchScope[] | undefined;
			if (searchIn && searchIn.some((scope) => !SEARCH_SCOPES.includes(scope))) {
				res.status(400).json({ message: req.t('search.invalidParam') });
				return;
			}

			const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;
			if (sort && !SORT_OPTIONS.includes(sort as SearchSortOption)) {
				res.status(400).json({ message: req.t('search.invalidParam') });
				return;
			}

			const hasFilters = Object.keys(filters).length > 0;

			// Keywords are required unless at least one filter is present
			// (filter-only browsing of the archive is allowed).
			if (!keywords && !hasFilters) {
				res.status(400).json({ message: req.t('search.keywordsRequired') });
				return;
			}

			const results = await this.searchService.searchEmails(
				{
					query: (keywords as string) ?? '',
					filters: hasFilters ? filters : undefined,
					searchIn,
					sort: sort as SearchSortOption | undefined,
					// Clamp to sane bounds: a NaN/zero/negative page yields a negative or
					// NaN Meilisearch offset (500), and an unbounded limit is a DoS vector.
					page: Math.max(1, Number.parseInt(page as string, 10) || 1),
					limit: Math.min(100, Math.max(1, Number.parseInt(limit as string, 10) || 10)),
					matchingStrategy: matchingStrategy as MatchingStrategies,
				},
				userId,
				req.ip || 'unknown'
			);

			res.status(200).json(results);
		} catch (error) {
			const message = error instanceof Error ? error.message : req.t('errors.unknown');
			res.status(500).json({ message });
		}
	};

	/** Typeahead suggestions for a facet field (e.g. mailbox addresses). */
	public facets = async (req: Request, res: Response): Promise<void> => {
		try {
			const userId = req.user?.sub;
			if (!userId) {
				res.status(401).json({ message: req.t('errors.unauthorized') });
				return;
			}

			const field = typeof req.query.field === 'string' ? req.query.field : '';
			if (!FACET_FIELDS.includes(field)) {
				res.status(400).json({ message: req.t('search.invalidParam') });
				return;
			}
			const query = typeof req.query.query === 'string' ? req.query.query : '';

			const values = await this.searchService.searchFacetValues(field, query, userId);
			res.status(200).json({ values });
		} catch (error) {
			const message = error instanceof Error ? error.message : req.t('errors.unknown');
			res.status(500).json({ message });
		}
	};
}
