import express from 'express';
import dotenv from 'dotenv';
import { AuthController } from './api/controllers/auth.controller';
import { IngestionController } from './api/controllers/ingestion.controller';
import { ArchivedEmailController } from './api/controllers/archived-email.controller';
import { StorageController } from './api/controllers/storage.controller';
import { SearchController } from './api/controllers/search.controller';
import { IamController } from './api/controllers/iam.controller';
import { requireAuth } from './api/middleware/requireAuth';
import { createAuthRouter } from './api/routes/auth.routes';
import { createIamRouter } from './api/routes/iam.routes';
import { createIngestionRouter } from './api/routes/ingestion.routes';
import { createArchivedEmailRouter } from './api/routes/archived-email.routes';
import { createStorageRouter } from './api/routes/storage.routes';
import { createSearchRouter } from './api/routes/search.routes';
import { createDashboardRouter } from './api/routes/dashboard.routes';
import { createUploadRouter } from './api/routes/upload.routes';
import { createUserRouter } from './api/routes/user.routes';
import { createSettingsRouter } from './api/routes/settings.routes';
import { AuthService } from './services/AuthService';
import { UserService } from './services/UserService';
import { IamService } from './services/IamService';
import { StorageService } from './services/StorageService';
import { SearchService } from './services/SearchService';
import { SettingsService } from './services/SettingsService';
import i18next from 'i18next';
import FsBackend from 'i18next-fs-backend';
import i18nextMiddleware from 'i18next-http-middleware';
import path from 'path';
import { logger } from './config/logger';

// Load environment variables
dotenv.config();

// --- Environment Variable Validation ---
const { PORT_BACKEND, JWT_SECRET, JWT_EXPIRES_IN } = process.env;

if (!PORT_BACKEND || !JWT_SECRET || !JWT_EXPIRES_IN) {
	throw new Error(
		'Missing required environment variables for the backend: PORT_BACKEND, JWT_SECRET, JWT_EXPIRES_IN.'
	);
}

// --- i18next Initialization ---
const initializeI18next = async () => {
	const systemSettings = await settingsService.getSettings();
	const defaultLanguage = systemSettings?.language || 'en';
	logger.info({ language: defaultLanguage }, 'Default language');
	await i18next.use(FsBackend).init({
		lng: defaultLanguage,
		fallbackLng: defaultLanguage,
		ns: ['translation'],
		defaultNS: 'translation',
		backend: {
			loadPath: path.resolve(__dirname, './locales/{{lng}}/{{ns}}.json'),
		},
	});
};

// --- Dependency Injection Setup ---

const userService = new UserService();
const authService = new AuthService(userService, JWT_SECRET, JWT_EXPIRES_IN);
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

// --- Express App Initialization ---
const app = express();

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
// upload route is added before middleware because it doesn't use the json middleware.
app.use('/v1/upload', uploadRouter);

// Middleware for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// i18n middleware
app.use(i18nextMiddleware.handle(i18next));

app.use('/v1/auth', authRouter);
app.use('/v1/iam', iamRouter);
app.use('/v1/ingestion-sources', ingestionRouter);
app.use('/v1/archived-emails', archivedEmailRouter);
app.use('/v1/storage', storageRouter);
app.use('/v1/search', searchRouter);
app.use('/v1/dashboard', dashboardRouter);
app.use('/v1/users', userRouter);
app.use('/v1/settings', settingsRouter);

// Example of a protected route
app.get('/v1/protected', requireAuth(authService), (req, res) => {
	res.json({
		message: 'You have accessed a protected route!',
		user: req.user, // The user payload is attached by the requireAuth middleware
	});
});

app.get('/', (req, res) => {
	res.send('Backend is running!');
});

// --- Server Start ---
const startServer = async () => {
	try {
		// Initialize i18next
		await initializeI18next();
		logger.info({}, 'i18next initialized');

		// Configure the Meilisearch index on startup
		logger.info({}, 'Configuring email index...');
		await searchService.configureEmailIndex();

		app.listen(PORT_BACKEND, () => {
			logger.info({}, `Backend listening at http://localhost:${PORT_BACKEND}`);
		});
	} catch (error) {
		logger.error({ error }, 'Failed to start the server:', error);
		process.exit(1);
	}
};

startServer();
