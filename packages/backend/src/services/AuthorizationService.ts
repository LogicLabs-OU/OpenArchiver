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
		// Make a copy of the resource so we don’t modify the original.
		// We lowercase the `userEmail` field (if present) to ensure case-insensitive
		// comparisons when checking permissions. This helps when policies compare
		// the user's email to placeholders like `${user.email}`, since CASL's
		// equality checks are case-sensitive by default.

        let subjectInstance: any;
        if (resourceObject) {
            let normalizedResource = resourceObject;
            if (
                resource === 'archive' &&
                typeof resourceObject === 'object' &&
                resourceObject !== null
            ) {
                if (
                    'userEmail' in resourceObject &&
                    typeof (resourceObject as any).userEmail === 'string'
                ) {
                    normalizedResource = {
                        ...resourceObject,
                        userEmail: (resourceObject as any).userEmail.toLowerCase(),
                    };
                }
            }
            subjectInstance = subject(resource, normalizedResource as Record<PropertyKey, any>);
        } else {
            subjectInstance = resource;
        }
        return ability.can(action, subjectInstance as AppSubjects);
    }
}
