import type { EmailDocument } from './email.types';

export type MatchingStrategy = 'last' | 'all' | 'frequency';

export interface SearchQuery {
	query: string;
	filters?: Record<string, any>;
	attributesToSearchOn?: string[];
	fieldQueries?: {
		attribute: string;
		query: string;
	}[];
	page?: number;
	limit?: number;
	matchingStrategy?: MatchingStrategy;
}

export interface SearchHit extends EmailDocument {
	_matchesPosition?: {
		[key: string]: { start: number; length: number; indices?: number[] }[];
	};
	_formatted?: Partial<EmailDocument>;
}

export interface SearchResult {
	hits: SearchHit[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
	processingTimeMs: number;
}
