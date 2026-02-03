import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AuthController } from './controllers/auth.controller';
import { IngestionController } from './controllers/ingestion.controller';
import { ArchivedEmailController } from './controllers/archived-email.controller';
import { StorageController } from './controllers/storage.controller';
import { SearchController } from './controllers/search.controller';
import { IamController } from './controllers/iam.controller';
import { createAuthRouter } from './routes/auth.routes';
import { createIamRouter } from './routes/iam.routes';
import { createIngestionRouter } from './routes/ingestion.routes';
import { createArchivedEmailRouter } from './routes/archived-email.routes';
import { createStorageRouter } from './routes/storage.routes';
import { createSearchRouter } from './routes/search.routes';
import { createDashboardRouter } from './routes/dashboard.routes';
import { createUploadRouter } from './routes/upload.routes';
import { createUserRouter } from './routes/user.routes';
import { createSettingsRouter } from './routes/settings.routes';
import { apiKeyRoutes } from './routes/api-key.routes';
import { integrityRoutes } from './routes/integrity.routes';
import { createJobsRouter } from './routes/jobs.routes';
import { AuthService } from '../services/AuthService';
import { AuditService } from '../services/AuditService';
import { UserService } from '../services/UserService';
import { IamService } from '../services/IamService';
import { StorageService } from '../services/StorageService';
import { SearchService } from '../services/SearchService';
import { SettingsService } from '../services/SettingsService';
import i18next from 'i18next';
import FsBackend from 'i18next-fs-backend';
import i18nextMiddleware from 'i18next-http-middleware';
import path from 'path';
import { logger } from '../config/logger';
import { rateLimiter } from './middleware/rateLimiter';
import { config } from '../config';
import { OpenArchiverFeature } from '@open-archiver/types';
// Define the "plugin" interface
export interface ArchiverModule {
	initialize: (app: Express, authService: AuthService) => Promise<void>;
	name: OpenArchiverFeature;
}

export let authService: AuthService;

export async function createServer(modules: ArchiverModule[] = []): Promise<Express> {
	// Load environment variables
	dotenv.config();

	// --- Environment Variable Validation ---
	const { JWT_SECRET, JWT_EXPIRES_IN } = process.env;

	if (!JWT_SECRET || !JWT_EXPIRES_IN) {
		throw new Error(
			'Missing required environment variables for the backend: JWT_SECRET, JWT_EXPIRES_IN.'
		);
	}

	// --- Dependency Injection Setup ---
	const auditService = new AuditService();
	const userService = new UserService();
	authService = new AuthService(userService, auditService, JWT_SECRET, JWT_EXPIRES_IN);
	const authController = new AuthController(authService, userService);
	const ingestionController = new IngestionController();
	const archivedEmailController = new ArchivedEmailController();
	const storageService = new StorageService();
	const storageController = new StorageController(storageService);
	const searchService = new SearchService();
	const searchController = new SearchController();
	const iamService = new IamService();
	const iamController = new IamController(iamService);
	const settingsService = new SettingsService();

	// --- i18next Initialization ---
	const initializeI18next = async () => {
		const systemSettings = await settingsService.getSystemSettings();
		const defaultLanguage = systemSettings?.language || 'en';
		logger.info({ language: defaultLanguage }, 'Default language');
		await i18next.use(FsBackend).init({
			lng: defaultLanguage,
			fallbackLng: defaultLanguage,
			ns: ['translation'],
			defaultNS: 'translation',
			backend: {
				loadPath: path.resolve(__dirname, '../locales/{{lng}}/{{ns}}.json'),
			},
		});
	};

	// Initialize i18next
	await initializeI18next();
	logger.info({}, 'i18next initialized');

	// Configure the Meilisearch index on startup
	logger.info({}, 'Configuring email index...');
	await searchService.configureEmailIndex();

	const app = express();

	// --- CORS ---
	app.use(
		cors({
			origin: process.env.APP_URL || 'http://localhost:3000',
			credentials: true,
		})
	);

	// Trust the proxy to get the real IP address of the client.
	// This is important for audit logging and security.
	app.set('trust proxy', true);

	// --- Routes ---
	const authRouter = createAuthRouter(authController);
	const ingestionRouter = createIngestionRouter(ingestionController, authService);
	const archivedEmailRouter = createArchivedEmailRouter(archivedEmailController, authService);
	const storageRouter = createStorageRouter(storageController, authService);
	const searchRouter = createSearchRouter(searchController, authService);
	const dashboardRouter = createDashboardRouter(authService);
	const iamRouter = createIamRouter(iamController, authService);
	const uploadRouter = createUploadRouter(authService);
	const userRouter = createUserRouter(authService);
	const settingsRouter = createSettingsRouter(authService);
	const apiKeyRouter = apiKeyRoutes(authService);
	const integrityRouter = integrityRoutes(authService);
	const jobsRouter = createJobsRouter(authService);

	// Middleware for all other routes
	app.use((req, res, next) => {
		// exclude certain API endpoints from the rate limiter, for example status, system settings
		const excludedPatterns = [/^\/v\d+\/auth\/status$/, /^\/v\d+\/settings\/system$/];
		for (const pattern of excludedPatterns) {
			if (pattern.test(req.path)) {
				return next();
			}
		}
		rateLimiter(req, res, next);
	});
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));

	// i18n middleware
	app.use(i18nextMiddleware.handle(i18next));

	app.use(`/${config.api.version}/auth`, authRouter);
	app.use(`/${config.api.version}/iam`, iamRouter);
	app.use(`/${config.api.version}/upload`, uploadRouter);
	app.use(`/${config.api.version}/ingestion-sources`, ingestionRouter);
	app.use(`/${config.api.version}/archived-emails`, archivedEmailRouter);
	app.use(`/${config.api.version}/storage`, storageRouter);
	app.use(`/${config.api.version}/search`, searchRouter);
	app.use(`/${config.api.version}/dashboard`, dashboardRouter);
	app.use(`/${config.api.version}/users`, userRouter);
	app.use(`/${config.api.version}/settings`, settingsRouter);
	app.use(`/${config.api.version}/api-keys`, apiKeyRouter);
	app.use(`/${config.api.version}/integrity`, integrityRouter);
	app.use(`/${config.api.version}/jobs`, jobsRouter);

	// Load all provided extension modules
	for (const module of modules) {
		await module.initialize(app, authService);
		console.log(`🏢 Enterprise module loaded: ${module.name}`);
	}
	app.get('/', (req, res) => {
		res.send('Backend is running!!');
	});

	console.log('✅ Core OSS modules loaded.');

	return app;
}
