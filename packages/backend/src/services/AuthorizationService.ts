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
			? subject(resource, this.#normalizeSubject(resourceObject))
			: resource;
		return ability.can(action, subjectInstance as AppSubjects);
	}

	/**
	 * Returns a copy of the row with its mailbox address lowercased, to match the policy
	 * conditions normalized in IamService. A copy rather than a mutation: callers such as
	 * ArchivedEmailService.getArchivedEmailById hand the same object to the client, and the
	 * mailbox address must keep the casing the provider gave it.
	 */
	#normalizeSubject(resourceObject: SubjectObject): Record<PropertyKey, any> {
		const record = resourceObject as Record<PropertyKey, any>;
		if (typeof record?.userEmail === 'string') {
			return { ...record, userEmail: record.userEmail.toLowerCase() };
		}
		return record;
	}
}
