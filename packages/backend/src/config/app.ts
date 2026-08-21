import 'dotenv/config';
import { intFromEnv } from '../helpers/intFromEnv';

export const app = {
	nodeEnv: process.env.NODE_ENV || 'development',
	port: intFromEnv('PORT_BACKEND', 4000, 1, 65535),
	encryptionKey: process.env.ENCRYPTION_KEY,
	/** The instance's public URL. Forms the OAuth redirect URI ({publicUrl}/api/v1/oauth/callback). */
	publicUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
	syncFrequency: process.env.SYNC_FREQUENCY || '* * * * *', //default to 1 minute
	enableDeletion: process.env.ENABLE_DELETION === 'true',
	allInclusiveArchive: process.env.ALL_INCLUSIVE_ARCHIVE === 'true',
	isDemo: process.env.IS_DEMO === 'true',
};
