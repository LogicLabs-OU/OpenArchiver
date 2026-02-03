import { Request, Response } from 'express';
import { SearchService } from '../../services/SearchService';
import { MatchingStrategies } from 'meilisearch';

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

			if (!keywords) {
				res.status(400).json({ message: req.t('search.keywordsRequired') });
				return;
			}

			const results = await this.searchService.searchEmails(
				{
					query: keywords as string,
					page: page ? parseInt(page as string) : 1,
					limit: limit ? parseInt(limit as string) : 10,
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
}
