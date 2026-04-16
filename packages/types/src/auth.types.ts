import type { JWTPayload } from 'jose';
import type { User } from './user.types';

/**
 * Defines the payload structure for the JWT, extending the standard JWTPayload.
 * This is the data that will be encoded into the token.
 */
export interface AuthTokenPayload extends JWTPayload {
	/**
	 * The user's email address.
	 */
	email: string;
	/**
	 * The user's assigned roles, which determines their permissions.
	 */
	roles: string[];
	/**
	 * True when the token represents a completed MFA verification.
	 * Only present on enterprise instances with 2FA enabled.
	 */
	mfaVerified?: boolean;
	/**
	 * True when the token is a short-lived pending token awaiting MFA verification.
	 * This token cannot be used to access protected routes.
	 */
	mfaPending?: boolean;
	/**
	 * True when the pending token is for a grace-expired unenrolled user who must
	 * complete TOTP enrollment before gaining full access. Only valid with the
	 * forced-enrollment endpoints; rejected by the standard verifyMfa endpoint.
	 */
	mfaEnrollmentRequired?: boolean;
}

/**
 * Defines the structure of the response from a successful login request.
 */
export interface LoginResponse {
	/**
	 * The JSON Web Token for authenticating subsequent requests.
	 */
	accessToken: string;
	/**
	 * The authenticated user's information.
	 */
	user: Omit<User, 'password'>;
}

/**
 * Returned by AuthService when the user needs to complete an MFA challenge.
 * The `mfaPendingToken` is consumed by the auth controller to set an httpOnly cookie;
 * it is NEVER forwarded to the client in the response body.
 */
export interface MfaPendingResponse {
	/** Short-lived JWT used by the controller to set the httpOnly mfaPending cookie. */
	mfaPendingToken: string;
	/** Always true — used by the auth controller to distinguish from a normal LoginResponse. */
	requiresMfa: true;
}

/**
 * The union return type for the login endpoint.
 * - `LoginResponse` — credentials valid, no MFA required.
 * - `MfaPendingResponse` — credentials valid, MFA challenge required.
 * - `null` — credentials invalid.
 */
export type LoginResult = LoginResponse | MfaPendingResponse | null;
