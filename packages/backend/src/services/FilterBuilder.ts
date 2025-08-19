import { SQL, sql } from 'drizzle-orm';
import { IamService } from './IamService';
import { rulesToQuery } from '@casl/ability/extra';
import { mongoToDrizzle } from '../helpers/mongoToDrizzle';
import { AppActions, AppSubjects } from '@open-archiver/types';

export class FilterBuilder {
	public static async create(
		userId: string,
		resourceType: AppSubjects,
		action: AppActions
	): Promise<{
		drizzleFilter: SQL | undefined;
		mongoFilter: Record<string, any> | null;
	}> {
		const iamService = new IamService();
		const ability = await iamService.getAbilityForUser(userId);

		// If the user can perform the action on any instance of the resource type
		// without any specific conditions, they have full access.
		if (ability.can(action, resourceType)) {
			const rules = ability.rulesFor(action, resourceType);
			const hasUnconditionalRule = rules.some((rule) => !rule.conditions);
			if (hasUnconditionalRule) {
				return { drizzleFilter: undefined, mongoFilter: null }; // Full access
			}
		}

		const query = rulesToQuery(ability, action, resourceType, (rule) => rule.conditions);

		if (query === null) {
			return { drizzleFilter: undefined, mongoFilter: null }; // Full access
		}

		if (Object.keys(query).length === 0) {
			return { drizzleFilter: sql`1=0`, mongoFilter: {} }; // No access
		}

		return { drizzleFilter: mongoToDrizzle(query), mongoFilter: query };
	}
}
