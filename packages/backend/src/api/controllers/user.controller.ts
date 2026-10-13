import { Request, Response } from 'express';
import { UserService } from '../../services/UserService';
import * as schema from '../../database/schema';
import { sql } from 'drizzle-orm';
import { db } from '../../database';
import { config } from '../../config';

const userService = new UserService();

export const getUsers = async (req: Request, res: Response) => {
	const users = await userService.findAll();
	res.json(users);
};

export const getUser = async (req: Request, res: Response) => {
	const user = await userService.findById(req.params.id);
	if (!user) {
		return res.status(404).json({ message: req.t('user.notFound') });
	}
	res.json(user);
};

export const createUser = async (req: Request, res: Response) => {
	const { email, first_name, last_name, password, roleId } = req.body;
	if (!req.user || !req.user.sub) {
		return res.status(401).json({ message: 'Unauthorized' });
	}
	const actor = await userService.findById(req.user.sub);
	if (!actor) {
		return res.status(401).json({ message: 'Unauthorized' });
	}

	const newUser = await userService.createUser(
		{ email, first_name, last_name, password },
		roleId,
		actor,
		req.ip || 'unknown'
	);
	res.status(201).json(newUser);
};

export const updateUser = async (req: Request, res: Response) => {
	const { email, first_name, last_name, roleId } = req.body;
	if (!req.user || !req.user.sub) {
		return res.status(401).json({ message: 'Unauthorized' });
	}
	const actor = await userService.findById(req.user.sub);
	if (!actor) {
		return res.status(401).json({ message: 'Unauthorized' });
	}

	const target = await userService.findById(req.params.id);
	if (!target) {
		return res.status(404).json({ message: req.t('user.notFound') });
	}

	// Not self-service: this route is Super Admin only, and preparing a local
	// account on a federated domain ahead of someone's first sign-in is exactly
	// how "Link to existing accounts" is meant to be used. A federated account's
	// address stays off limits even here, since the provider re-asserts it.
	const decision = await userService.assessEmailChange(target, email, false);
	if (decision.outcome === 'denied') {
		return res.status(decision.status).json({ message: req.t(decision.reason) });
	}

	const updatedUser = await userService.updateUser(
		req.params.id,
		{
			first_name,
			last_name,
			...(decision.outcome === 'allowed' ? { email: decision.email } : {}),
		},
		roleId,
		actor,
		req.ip || 'unknown'
	);
	if (!updatedUser) {
		return res.status(404).json({ message: req.t('user.notFound') });
	}
	res.json(updatedUser);
};

export const deleteUser = async (req: Request, res: Response) => {
	const userCountResult = await db.select({ count: sql<number>`count(*)` }).from(schema.users);

	const isOnlyUser = Number(userCountResult[0].count) === 1;
	if (isOnlyUser) {
		return res.status(400).json({
			message: req.t('user.cannotDeleteOnlyUser'),
		});
	}
	if (!req.user || !req.user.sub) {
		return res.status(401).json({ message: 'Unauthorized' });
	}
	const actor = await userService.findById(req.user.sub);
	if (!actor) {
		return res.status(401).json({ message: 'Unauthorized' });
	}
	await userService.deleteUser(req.params.id, actor, req.ip || 'unknown');
	res.status(204).send();
};

export const getProfile = async (req: Request, res: Response) => {
	if (!req.user || !req.user.sub) {
		return res.status(401).json({ message: 'Unauthorized' });
	}
	const user = await userService.findById(req.user.sub);
	if (!user) {
		return res.status(404).json({ message: req.t('user.notFound') });
	}
	res.json(user);
};

export const updateProfile = async (req: Request, res: Response) => {
	if (config.app.isDemo) {
		return res.status(403).json({ message: req.t('errors.demoMode') });
	}
	const { email, first_name, last_name } = req.body;
	if (!req.user || !req.user.sub) {
		return res.status(401).json({ message: 'Unauthorized' });
	}
	const actor = await userService.findById(req.user.sub);
	if (!actor) {
		return res.status(401).json({ message: 'Unauthorized' });
	}

	// The address decides who a later SSO assertion links to and whether the
	// "require single sign-on" policy covers this account, so it is not the
	// account holder's to choose freely. A read-only field in the UI is only a
	// display; the refusal has to happen here.
	const decision = await userService.assessEmailChange(actor, email, true);
	if (decision.outcome === 'denied') {
		return res.status(decision.status).json({ message: req.t(decision.reason) });
	}

	const updatedUser = await userService.updateUser(
		req.user.sub,
		{
			first_name,
			last_name,
			...(decision.outcome === 'allowed' ? { email: decision.email } : {}),
		},
		undefined,
		actor,
		req.ip || 'unknown'
	);
	res.json(updatedUser);
};

export const updatePassword = async (req: Request, res: Response) => {
	if (config.app.isDemo) {
		return res.status(403).json({ message: req.t('errors.demoMode') });
	}
	const { currentPassword, newPassword } = req.body;
	if (!req.user || !req.user.sub) {
		return res.status(401).json({ message: 'Unauthorized' });
	}
	const actor = await userService.findById(req.user.sub);
	if (!actor) {
		return res.status(401).json({ message: 'Unauthorized' });
	}

	try {
		await userService.updatePassword(
			req.user.sub,
			currentPassword,
			newPassword,
			actor,
			req.ip || 'unknown'
		);
		res.status(200).json({ message: 'Password updated successfully' });
	} catch (e: any) {
		if (e.message === 'Invalid current password') {
			return res.status(400).json({ message: e.message });
		}
		throw e;
	}
};
