import { IamService } from './IamService';
import { createAbilityFor, SubjectObject } from '../iam-policy/ability';
import { subject, Subject } from '@casl/ability';
import { AppActions, AppSubjects } from '@open-archiver/types';

export class AuthorizationService {
	private iamService: IamService;

	constructor() {
		this.iamService = new IamService();
	}

	public async can(
		userId: string,
		action: AppActions,
		resource: AppSubjects,
		resourceObject?: SubjectObject
	): Promise<boolean> {
		const ability = await this.iamService.getAbilityForUser(userId);
		const subjectInstance = resourceObject
			? subject(resource, resourceObject as Record<PropertyKey, any>)
			: resource;
		return ability.can(action, subjectInstance as AppSubjects);
	}
}
