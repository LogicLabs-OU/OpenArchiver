import { compare } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthTokenPayload, LoginResponse } from '@open-archiver/types';
import { UserService } from './UserService';
import { AuditService } from './AuditService';
import { db } from '../database';
import * as schema from '../database/schema';
import { eq } from 'drizzle-orm';

export class AuthService {
	#userService: UserService;
	#auditService: AuditService;
	#jwtSecret: Uint8Array;
	#jwtExpiresIn: string;

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

	public async login(email: string, password: string, ip: string): Promise<LoginResponse | null> {
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
}
