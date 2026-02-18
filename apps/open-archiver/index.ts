import { createServer, logger } from '@open-archiver/backend';
import * as dotenv from 'dotenv';

dotenv.config();

async function start() {
	// --- Environment Variable Validation ---
	const { PORT_BACKEND, HOST_BACKEND = '0.0.0.0' } = process.env;

	if (!PORT_BACKEND) {
		throw new Error('Missing required environment variables for the backend: PORT_BACKEND.');
	}
	// Create the server instance (passing no modules for the default OSS version)
	const app = await createServer([]);

	app.listen(Number(PORT_BACKEND), HOST_BACKEND, () => {
		logger.info({}, `✅ Open Archiver (OSS) running at http://${HOST_BACKEND}:${PORT_BACKEND}`);
	});
}

start().catch((error) => {
	logger.error({ error }, 'Failed to start the server:', error);
	process.exit(1);
});
