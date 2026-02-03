import { config } from '../config';
import i18next from 'i18next';

export function checkDeletionEnabled() {
	if (!config.app.enableDeletion) {
		const errorMessage = i18next.t('Deletion is disabled for this instance.');
		throw new Error(errorMessage);
	}
}
