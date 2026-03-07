import { config } from '../config';
import i18next from 'i18next';

interface DeletionOptions {
	allowSystemDelete?: boolean;
}

export function checkDeletionEnabled(options?: DeletionOptions) {
	// If system delete is allowed (e.g. by retention policy), bypass the config check
	if (options?.allowSystemDelete) {
		return;
	}

	if (!config.app.enableDeletion) {
		const errorMessage = i18next.t('Deletion is disabled for this instance.');
		throw new Error(errorMessage);
	}
}
