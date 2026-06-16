import { Request, Response } from 'express';
import { SearchService } from '../../services/SearchService';
import { MatchingStrategies } from 'meilisearch';
import type { MatchingStrategy } from '@open-archiver/types';

const ALLOWED_MATCHING_STRATEGIES = new Set<MatchingStrategy>(['last', 'all', 'frequency']);
const ADDRESS_FILTER_PARAMS = ['from', 'to', 'cc', 'bcc'] as const;
const FIELD_SEARCH_PARAMS = {
	subject: 'subject',
	body: 'body',
	attachmentFilename: 'attachments.filename',
	attachmentContent: 'attachments.content',
} as const;
const SEARCHABLE_ATTRIBUTES = [
	'subject',
	'body',
	'from',
	'to',
	'cc',
	'bcc',
	'attachments.filename',
	'attachments.content',
	'userEmail',
];

export class SearchController {
	private searchService: SearchService;

	constructor() {
		this.searchService = new SearchService();
	}

	public search = async (req: Request, res: Response): Promise<void> => {
		try {
			const { keywords, page, limit, matchingStrategy, dateFrom, dateTo } = req.query;
			const userId = req.user?.sub;

			if (!userId) {
				res.status(401).json({ message: req.t('errors.unauthorized') });
				return;
			}

			const keywordQuery = this.cleanString(keywords);
			const addressFilters = this.getAddressFilters(req.query);
			const fieldSearch = this.getFieldSearch(req.query);
			const dateRange = this.getDateRange(dateFrom, dateTo);
			if (dateRange.invalid) {
				res.status(400).json({ message: 'Invalid date range.' });
				return;
			}

			const hasSearchCriteria =
				keywordQuery ||
				Object.keys(addressFilters).length > 0 ||
				fieldSearch.length > 0 ||
				Boolean(dateRange.range);

			if (!hasSearchCriteria) {
				res.status(400).json({ message: req.t('search.keywordsRequired') });
				return;
			}

			const filters: Record<string, unknown> = { ...addressFilters };
			if (dateRange.range) {
				filters.timestamp = dateRange.range;
			}

			const safeMatchingStrategy = this.getMatchingStrategy(matchingStrategy);

			const results = await this.searchService.searchEmails(
				{
					query: keywordQuery,
					filters,
					attributesToSearchOn: SEARCHABLE_ATTRIBUTES,
					fieldQueries: fieldSearch,
					page: this.getPositiveInteger(page, 1),
					limit: Math.min(this.getPositiveInteger(limit, 10), 100),
					matchingStrategy: safeMatchingStrategy as MatchingStrategies,
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

	private cleanString(value: unknown): string {
		const raw = Array.isArray(value) ? value[0] : value;
		return typeof raw === 'string' ? raw.trim().slice(0, 500) : '';
	}

	private getPositiveInteger(value: unknown, fallback: number): number {
		const raw = Array.isArray(value) ? value[0] : value;
		const parsed = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
		return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
	}

	private getMatchingStrategy(value: unknown): MatchingStrategy {
		const strategy = this.cleanString(value) as MatchingStrategy;
		return ALLOWED_MATCHING_STRATEGIES.has(strategy) ? strategy : 'last';
	}

	private getAddressFilters(query: Request['query']): Record<string, string> {
		return ADDRESS_FILTER_PARAMS.reduce<Record<string, string>>((filters, key) => {
			const value = this.cleanString(query[key]);
			if (value) {
				filters[key] = value;
			}
			return filters;
		}, {});
	}

	private getFieldSearch(query: Request['query']): { attribute: string; query: string }[] {
		const fieldQueries: { attribute: string; query: string }[] = [];

		for (const [param, attribute] of Object.entries(FIELD_SEARCH_PARAMS)) {
			const value = this.cleanString(query[param]);
			if (value) {
				fieldQueries.push({ attribute, query: value });
			}
		}

		return fieldQueries;
	}

	private getDateRange(
		dateFrom: unknown,
		dateTo: unknown
	): { range: { from?: number; to?: number } | null; invalid: boolean } {
		const from = this.parseDate(dateFrom, false);
		const to = this.parseDate(dateTo, true);

		if (from === null || to === null) {
			return { range: null, invalid: true };
		}

		if (from === undefined && to === undefined) {
			return { range: null, invalid: false };
		}

		if (from !== undefined && to !== undefined && from > to) {
			return { range: null, invalid: true };
		}

		return { range: { from, to }, invalid: false };
	}

	private parseDate(value: unknown, endOfDay: boolean): number | undefined | null {
		const dateString = this.cleanString(value);
		if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
			return dateString ? null : undefined;
		}

		const [year, month, day] = dateString.split('-').map(Number);
		const time = Date.UTC(
			year,
			month - 1,
			day,
			endOfDay ? 23 : 0,
			endOfDay ? 59 : 0,
			endOfDay ? 59 : 0,
			endOfDay ? 999 : 0
		);
		const date = new Date(time);
		if (
			date.getUTCFullYear() !== year ||
			date.getUTCMonth() !== month - 1 ||
			date.getUTCDate() !== day
		) {
			return null;
		}

		return time;
	}
}
