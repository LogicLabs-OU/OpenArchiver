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
