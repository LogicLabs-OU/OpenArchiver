import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { User } from '@open-archiver/types';

interface AuthState {
	accessToken: string | null;
	user: Omit<User, 'passwordHash'> | null;
}

const initialValue: AuthState = {
	accessToken: null,
	user: null,
};

// Function to get the initial state from localStorage
const createAuthStore = () => {
	const { subscribe, set } = writable<AuthState>(initialValue);

	return {
		subscribe,
		login: (accessToken: string, user: Omit<User, 'passwordHash'>) => {
			if (browser) {
				document.cookie = `accessToken=${accessToken}; path=/; max-age=604800; samesite=lax`;
			}
			set({ accessToken, user });
		},
		logout: () => {
			if (browser) {
				document.cookie = 'accessToken=; path=/; max-age=-1; samesite=lax';
			}
			set(initialValue);
		},
		syncWithServer: (user: Omit<User, 'passwordHash'> | null, accessToken: string | null) => {
			if (user && accessToken) {
				set({ accessToken, user });
			} else {
				set(initialValue);
			}
		},
	};
};

export const authStore = createAuthStore();
