import { Request, Response } from 'express';
import { IamService } from '../../services/IamService';
import { PolicyValidator } from '../../iam-policy/policy-validator';
import type { CaslPolicy } from '@open-archiver/types';
import { logger } from '../../config/logger';

export class IamController {
	#iamService: IamService;

	constructor(iamService: IamService) {
		this.#iamService = iamService;
	}

	public getRoles = async (req: Request, res: Response): Promise<void> => {
		try {
			let roles = await this.#iamService.getRoles();
			if (!roles.some((r) => r.slug?.includes('predefined_'))) {
				// create pre defined roles
				logger.info({}, 'Creating predefined roles');
				await this.createDefaultRoles();
			}
			res.status(200).json(roles);
		} catch (error) {
			res.status(500).json({ message: req.t('iam.failedToGetRoles') });
		}
	};

	public getRoleById = async (req: Request, res: Response): Promise<void> => {
		const { id } = req.params;

		try {
			const role = await this.#iamService.getRoleById(id);
			if (role) {
				res.status(200).json(role);
			} else {
				res.status(404).json({ message: req.t('iam.roleNotFound') });
			}
		} catch (error) {
			res.status(500).json({ message: req.t('iam.failedToGetRole') });
		}
	};

	public createRole = async (req: Request, res: Response) => {
		const { name, policies } = req.body;

		if (!name || !policies) {
			res.status(400).json({ message: req.t('iam.missingRoleFields') });
			return;
		}

		try {
			for (const statement of policies) {
				const { valid, reason } = PolicyValidator.isValid(statement as CaslPolicy);
				if (!valid) {
					res.status(400).json({ message: `${req.t('iam.invalidPolicy')} ${reason}` });
					return;
				}
			}
			const role = await this.#iamService.createRole(name, policies);
			res.status(201).json(role);
		} catch (error) {
			console.log(error);
			res.status(500).json({ message: req.t('iam.failedToCreateRole') });
		}
	};

	public deleteRole = async (req: Request, res: Response) => {
		const { id } = req.params;

		try {
			await this.#iamService.deleteRole(id);
			res.status(204).send();
		} catch (error) {
			res.status(500).json({ message: req.t('iam.failedToDeleteRole') });
		}
	};

	public updateRole = async (req: Request, res: Response) => {
		const { id } = req.params;
		const { name, policies } = req.body;

		if (!name && !policies) {
			res.status(400).json({ message: req.t('iam.missingUpdateFields') });
			return;
		}

		if (policies) {
			for (const statement of policies) {
				const { valid, reason } = PolicyValidator.isValid(statement as CaslPolicy);
				if (!valid) {
					res.status(400).json({ message: `${req.t('iam.invalidPolicy')} ${reason}` });
					return;
				}
			}
		}

		try {
			const role = await this.#iamService.updateRole(id, { name, policies });
			res.status(200).json(role);
		} catch (error) {
			res.status(500).json({ message: req.t('iam.failedToUpdateRole') });
		}
	};

	private createDefaultRoles = async () => {
		try {
			// end user who can manage its own data, and create new ingestions.
			await this.#iamService.createRole(
				'End user',
				[
					{
						action: 'read',
						subject: 'dashboard',
					},
					{
						action: 'create',
						subject: 'ingestion',
					},
					{
						action: 'manage',
						subject: 'ingestion',
						conditions: {
							userId: '${user.id}',
						},
					},
					{
						action: 'manage',
						subject: 'archive',
						conditions: {
							'ingestionSource.userId': '${user.id}',
						},
					},
				],
				'predefined_end_user'
			);
			// read only
			await this.#iamService.createRole(
				'Read only',
				[
					{
						action: ['read', 'search'],
						subject: ['ingestion', 'archive', 'dashboard', 'users', 'roles'],
					},
				],
				'predefined_read_only_user'
			);
		} catch (error) {
			logger.error({}, 'Failed to create default roles');
		}
	};
}
