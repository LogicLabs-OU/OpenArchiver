import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { jwtVerify } from 'jose';
import type { AuthTokenPayload } from '@open-archiver/types';

const JWT_SECRET_ENCODED = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * Guard: decode the mfaPending cookie to determine the correct MFA page.
 *
 * - No cookie → redirect to /signin (unauthenticated).
 * - Cookie present but mfaEnrollmentRequired=true → redirect to /signin/mfa/enroll
 *   (this is a forced-enrollment token; the verify endpoint will reject it).
 * - Cookie present and normal mfaPending token → allow through.
 * - Token invalid/expired → redirect to /signin.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const token = cookies.get('mfaPending');

	if (!token) {
		redirect(302, '/signin');
	}

	try {
		const { payload } = await jwtVerify<AuthTokenPayload>(token, JWT_SECRET_ENCODED);

		// Forced-enrollment token — wrong page; route to the enrollment flow.
		if (payload.mfaEnrollmentRequired) {
			redirect(302, '/signin/mfa/enroll');
		}
	} catch {
		// Token invalid or expired — send back to login.
		redirect(302, '/signin');
	}

	return {};
};
