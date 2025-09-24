import { storage } from './storage';
import { app } from './app';
import { searchConfig, meiliConfig } from './search';
import { connection as redisConfig } from './redis';
import { apiConfig } from './api';

export const config = {
	storage,
	app,
	search: searchConfig,
	meili: meiliConfig,
	redis: redisConfig,
	api: apiConfig,
};
