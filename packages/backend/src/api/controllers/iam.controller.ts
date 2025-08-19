import { Request, Response } from 'express';
import { IamService } from '../../services/IamService';
import { PolicyValidator } from '../../iam-policy/policy-validator';
import type { CaslPolicy } from '@open-archiver/types';

export class IamController {
	#iamService: IamService;

	constructor(iamService: IamService) {
		this.#iamService = iamService;
	}

	public getRoles = async (req: Request, res: Response): Promise<void> => {
		try {
			const roles = await this.#iamService.getRoles();
			res.status(200).json(roles);
		} catch (error) {
			res.status(500).json({ message: 'Failed to get roles.' });
		}
	};

	public getRoleById = async (req: Request, res: Response): Promise<void> => {
		const { id } = req.params;

		try {
			const role = await this.#iamService.getRoleById(id);
			if (role) {
				res.status(200).json(role);
			} else {
				res.status(404).json({ message: 'Role not found.' });
			}
		} catch (error) {
			res.status(500).json({ message: 'Failed to get role.' });
		}
	};

	public createRole = async (req: Request, res: Response): Promise<void> => {
		const { name, policies } = req.body;

		if (!name || !policies) {
			res.status(400).json({ message: 'Missing required fields: name and policy.' });
			return;
		}

		for (const statement of policies) {
			const { valid, reason } = PolicyValidator.isValid(statement as CaslPolicy);
			if (!valid) {
				res.status(400).json({ message: `Invalid policy statement: ${reason}` });
				return;
			}
		}

		try {
			const role = await this.#iamService.createRole(name, policies);
			res.status(201).json(role);
		} catch (error) {
			console.log(error);
			res.status(500).json({ message: 'Failed to create role.' });
		}
	};

	public deleteRole = async (req: Request, res: Response): Promise<void> => {
		const { id } = req.params;

		try {
			await this.#iamService.deleteRole(id);
			res.status(204).send();
		} catch (error) {
			res.status(500).json({ message: 'Failed to delete role.' });
		}
	};

	public updateRole = async (req: Request, res: Response): Promise<void> => {
		const { id } = req.params;
		const { name, policies } = req.body;

		if (!name && !policies) {
			res.status(400).json({ message: 'Missing fields to update: name or policies.' });
			return;
		}

		if (policies) {
			for (const statement of policies) {
				const { valid, reason } = PolicyValidator.isValid(statement as CaslPolicy);
				if (!valid) {
					res.status(400).json({ message: `Invalid policy statement: ${reason}` });
					return;
				}
			}
		}

		try {
			const role = await this.#iamService.updateRole(id, { name, policies });
			res.status(200).json(role);
		} catch (error) {
			res.status(500).json({ message: 'Failed to update role.' });
		}
	};
}
