import type { Handle } from '@sveltejs/kit';
import { jwtVerify } from 'jose';
import type { User } from '@open-archiver/types';
import 'dotenv/config';

const JWT_SECRET_ENCODED = new TextEncoder().encode(process.env.JWT_SECRET);

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('accessToken');

	if (token) {
		try {
			const { payload } = await jwtVerify(token, JWT_SECRET_ENCODED);
			event.locals.user = payload as Omit<User, 'passwordHash'>;
			event.locals.accessToken = token;
		} catch (error) {
			console.error('JWT verification failed:', error);
			event.locals.user = null;
			event.locals.accessToken = null;
		}
	} else {
		event.locals.user = null;
		event.locals.accessToken = null;
	}
	if (import.meta.env.VITE_ENTERPRISE_MODE === true) {
		event.locals.enterpriseMode = true;
	} else {
		event.locals.enterpriseMode = false;
	}

	return resolve(event);
};
