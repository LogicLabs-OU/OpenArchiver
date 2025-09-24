import 'dotenv/config';

export const searchConfig = {
	host: process.env.MEILI_HOST || 'http://127.0.0.1:7700',
	apiKey: process.env.MEILI_MASTER_KEY || '',
};

export const meiliConfig = {
	indexingBatchSize: process.env.MEILI_INDEXING_BATCH
		? parseInt(process.env.MEILI_INDEXING_BATCH)
		: 500,
};
