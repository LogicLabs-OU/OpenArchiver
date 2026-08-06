import { compare } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type {
	AuthTokenPayload,
	LoginResult,
	LoginResponse,
	MfaPendingResponse,
	MfaCheckResult,
} from '@open-archiver/types';
import { UserService } from './UserService';
import { AuditService } from './AuditService';
import { db } from '../database';
import * as schema from '../database/schema';
import { eq } from 'drizzle-orm';

/** Callback type for checking if MFA is required for a user. Registered by enterprise module. */
export type MfaCheckCallback = (userId: string) => Promise<MfaCheckResult>;

export class AuthService {
	#userService: UserService;
	#auditService: AuditService;
	#jwtSecret: Uint8Array;
	#jwtExpiresIn: string;
	#mfaCheckCallback: MfaCheckCallback | null = null;

	constructor(
		userService: UserService,
		auditService: AuditService,
		jwtSecret: string,
		jwtExpiresIn: string
	) {
		this.#userService = userService;
		this.#auditService = auditService;
		this.#jwtSecret = new TextEncoder().encode(jwtSecret);
		this.#jwtExpiresIn = jwtExpiresIn;
	}

	/**
	 * Registers the MFA check callback. Called by the enterprise advanced-security module
	 * at startup to hook into the login flow.
	 */
	public registerMfaCheck(fn: MfaCheckCallback): void {
		this.#mfaCheckCallback = fn;
	}

	public async verifyPassword(password: string, hash: string): Promise<boolean> {
		return compare(password, hash);
	}

	async #generateAccessToken(payload: AuthTokenPayload): Promise<string> {
		if (!payload.sub) {
			throw new Error('JWT payload must have a subject (sub) claim.');
		}
		return new SignJWT(payload)
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setSubject(payload.sub)
			.setExpirationTime(this.#jwtExpiresIn)
			.sign(this.#jwtSecret);
	}

	public async login(email: string, password: string, ip: string): Promise<LoginResult> {
		const user = await this.#userService.findByEmail(email);

		if (!user || !user.password) {
			await this.#auditService.createAuditLog({
				actorIdentifier: email,
				actionType: 'LOGIN',
				targetType: 'User',
				targetId: email,
				actorIp: ip,
				details: {
					error: 'UserNotFound',
				},
			});
			return null; // User not found or password not set
		}

		const isPasswordValid = await this.verifyPassword(password, user.password);

		if (!isPasswordValid) {
			await this.#auditService.createAuditLog({
				actorIdentifier: user.id,
				actionType: 'LOGIN',
				targetType: 'User',
				targetId: user.id,
				actorIp: ip,
				details: {
					error: 'InvalidPassword',
				},
			});
			return null; // Invalid password
		}

		const userRoles = await db.query.userRoles.findMany({
			where: eq(schema.userRoles.userId, user.id),
			with: {
				role: true,
			},
		});

		const roles = userRoles.map((ur) => ur.role.name);

		const { password: _, ...userWithoutPassword } = user;

		// Check if MFA is required (enterprise hook)
		if (this.#mfaCheckCallback) {
			const mfaResult = await this.#mfaCheckCallback(user.id);

			if (mfaResult.required) {
				// Determine whether this is a normal challenge (enrolled user) or
				// a forced-enrollment case (grace-expired unenrolled user).
				const enrollmentRequired =
					!mfaResult.enrolled && mfaResult.gracePeriodExpired === true;

				const mfaPendingToken = await this.#generateMfaPendingToken(
					user.id,
					user.email,
					enrollmentRequired
				);

				await this.#auditService.createAuditLog({
					actorIdentifier: user.id,
					actionType: 'LOGIN',
					targetType: 'User',
					targetId: user.id,
					actorIp: ip,
					details: { mfaPending: true, enrollmentRequired },
				});

				return { mfaPendingToken, requiresMfa: true } satisfies MfaPendingResponse;
			}
		}

		const accessToken = await this.#generateAccessToken({
			sub: user.id,
			email: user.email,
			roles: roles,
		});

		await this.#auditService.createAuditLog({
			actorIdentifier: user.id,
			actionType: 'LOGIN',
			targetType: 'User',
			targetId: user.id,
			actorIp: ip,
			details: {},
		});

		return {
			accessToken,
			user: {
				...userWithoutPassword,
				role: null,
			},
		};
	}

	public async verifyToken(token: string): Promise<AuthTokenPayload | null> {
		try {
			const { payload } = await jwtVerify<AuthTokenPayload>(token, this.#jwtSecret);
			return payload;
		} catch (error) {
			// Token is invalid or expired
			return null;
		}
	}

	/**
	 * Generates a short-lived JWT indicating that the user has passed password authentication
	 * but still needs to complete a 2FA challenge or forced TOTP enrollment.
	 *
	 * @param enrollmentRequired - When true, the token can only be used with the
	 *   forced-enrollment endpoints (grace-expired unenrolled user). When false,
	 *   it is a standard MFA challenge token for an enrolled user.
	 */
	async #generateMfaPendingToken(
		userId: string,
		email: string,
		enrollmentRequired = false
	): Promise<string> {
		const payload: AuthTokenPayload = {
			sub: userId,
			email,
			roles: [],
			mfaPending: true,
			...(enrollmentRequired ? { mfaEnrollmentRequired: true } : {}),
		};

		// Extend TTL to 10 minutes for enrollment flow — user needs time to scan QR and confirm.
		// Standard MFA challenge keeps the original 5 minutes.
		const expiresIn = enrollmentRequired ? '10m' : '5m';

		return new SignJWT(payload as unknown as Record<string, unknown>)
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setSubject(userId)
			.setExpirationTime(expiresIn)
			.sign(this.#jwtSecret);
	}

	/**
	 * Generates a full-access token after MFA verification.
	 * Called by the enterprise advanced-security module.
	 */
	public async generateFullAccessToken(userId: string): Promise<LoginResponse | null> {
		const user = await this.#userService.findById(userId);
		if (!user) return null;

		const userRoles = await db.query.userRoles.findMany({
			where: eq(schema.userRoles.userId, userId),
			with: { role: true },
		});
		const roles = userRoles.map((ur) => ur.role.name);

		const accessToken = await this.#generateAccessToken({
			sub: userId,
			email: user.email,
			roles,
			mfaVerified: true,
		});

		return {
			accessToken,
			user: {
				...user,
				role: user.role,
			},
		};
	}
}
