import 'dotenv/config';

export const app = {
	nodeEnv: process.env.NODE_ENV || 'development',
	port: process.env.PORT_BACKEND ? parseInt(process.env.PORT_BACKEND, 10) : 4000,
	encryptionKey: process.env.ENCRYPTION_KEY,
	isDemo: process.env.IS_DEMO === 'true',
	syncFrequency: process.env.SYNC_FREQUENCY || '* * * * *', //default to 1 minute
	ocrEnabled: process.env.OCR_ENABLED === 'true',
	ocrLanguages: process.env.OCR_LANGUAGES || 'eng',
};
