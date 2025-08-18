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
import testRouter from './api/routes/test.routes';
import { AuthService } from './services/AuthService';
import { UserService } from './services/UserService';
import { IamService } from './services/IamService';
import { StorageService } from './services/StorageService';
import { SearchService } from './services/SearchService';

// Load environment variables
dotenv.config();

// --- Environment Variable Validation ---
const { PORT_BACKEND, JWT_SECRET, JWT_EXPIRES_IN } = process.env;

if (!PORT_BACKEND || !JWT_SECRET || !JWT_EXPIRES_IN) {
	throw new Error(
		'Missing required environment variables for the backend: PORT_BACKEND, JWT_SECRET, JWT_EXPIRES_IN.'
	);
}

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
// upload route is added before middleware because it doesn't use the json middleware.
app.use('/v1/upload', uploadRouter);

// Middleware for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/v1/auth', authRouter);
app.use('/v1/iam', iamRouter);
app.use('/v1/ingestion-sources', ingestionRouter);
app.use('/v1/archived-emails', archivedEmailRouter);
app.use('/v1/storage', storageRouter);
app.use('/v1/search', searchRouter);
app.use('/v1/dashboard', dashboardRouter);
app.use('/v1/test', testRouter);

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
		// Configure the Meilisearch index on startup
		console.log('Configuring email index...');
		await searchService.configureEmailIndex();

		app.listen(PORT_BACKEND, () => {
			console.log(`Backend listening at http://localhost:${PORT_BACKEND}`);
		});
	} catch (error) {
		console.error('Failed to start the server:', error);
		process.exit(1);
	}
};

startServer();
