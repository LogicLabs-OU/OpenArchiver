import { StorageConfig } from '@open-archiver/types';
import 'dotenv/config';

const storageType = process.env.STORAGE_TYPE;
const encryptionKey = process.env.STORAGE_ENCRYPTION_KEY;
const openArchiverFolderName = 'open-archiver';
let storageConfig: StorageConfig;

if (encryptionKey && !/^[a-fA-F0-9]{64}$/.test(encryptionKey)) {
	throw new Error('STORAGE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
}

if (storageType === 'local') {
	if (!process.env.STORAGE_LOCAL_ROOT_PATH) {
		throw new Error('STORAGE_LOCAL_ROOT_PATH is not defined in the environment variables');
	}
	storageConfig = {
		type: 'local',
		rootPath: process.env.STORAGE_LOCAL_ROOT_PATH,
		openArchiverFolderName: openArchiverFolderName,
		encryptionKey: encryptionKey,
	};
} else if (storageType === 's3') {
	if (
		!process.env.STORAGE_S3_ENDPOINT ||
		!process.env.STORAGE_S3_BUCKET ||
		!process.env.STORAGE_S3_ACCESS_KEY_ID ||
		!process.env.STORAGE_S3_SECRET_ACCESS_KEY
	) {
		throw new Error('One or more S3 storage environment variables are not defined');
	}
	storageConfig = {
		type: 's3',
		endpoint: process.env.STORAGE_S3_ENDPOINT,
		bucket: process.env.STORAGE_S3_BUCKET,
		accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
		secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
		region: process.env.STORAGE_S3_REGION,
		forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE === 'true',
		openArchiverFolderName: openArchiverFolderName,
		encryptionKey: encryptionKey,
	};
} else {
	throw new Error(`Invalid STORAGE_TYPE: ${storageType}`);
}

export const storage = storageConfig;
