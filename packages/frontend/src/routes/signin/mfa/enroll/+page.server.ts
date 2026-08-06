import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { jwtVerify } from 'jose';
import type { AuthTokenPayload } from '@open-archiver/types';

const JWT_SECRET_ENCODED = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * Guard: decode the mfaPending cookie to verify this is a forced-enrollment token.
 *
 * - No cookie → redirect to /signin (unauthenticated).
 * - Cookie present but mfaEnrollmentRequired is absent/false → redirect to /signin/mfa
 *   (this is a standard MFA challenge token; the enroll endpoint will reject it).
 * - Cookie present and mfaEnrollmentRequired=true → allow through.
 * - Token invalid/expired → redirect to /signin.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const token = cookies.get('mfaPending');

	if (!token) {
		redirect(302, '/signin');
	}

	try {
		const { payload } = await jwtVerify<AuthTokenPayload>(token, JWT_SECRET_ENCODED);

		// Standard MFA challenge token — wrong page; route to the verify flow.
		if (!payload.mfaEnrollmentRequired) {
			redirect(302, '/signin/mfa');
		}
	} catch {
		// Token invalid or expired — send back to login.
		redirect(302, '/signin');
	}

	return {};
};
