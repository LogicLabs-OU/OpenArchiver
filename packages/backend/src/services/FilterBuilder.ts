import { SQL, sql } from 'drizzle-orm';
import { IamService } from './IamService';
import { rulesToQuery } from '@casl/ability/extra';
import { mongoToDrizzle } from '../helpers/mongoToDrizzle';
import { mongoToMeli } from '../helpers/mongoToMeli';
import { AppActions, AppSubjects } from '@open-archiver/types';

export class FilterBuilder {
	public static async create(
		userId: string,
		resourceType: AppSubjects,
		action: AppActions
	): Promise<{
		drizzleFilter: SQL | undefined;
		searchFilter: string | undefined;
	}> {
		const iamService = new IamService();
		const ability = await iamService.getAbilityForUser(userId);

		// If the user has an unconditional `can` rule and no `cannot` rules,
		// they have full access and we can skip building a complex query.
		const rules = ability.rulesFor(action, resourceType);

		const hasUnconditionalCan = rules.some(
			(rule) => rule.inverted === false && !rule.conditions
		);
		const cannotConditions = rules
			.filter((rule) => rule.inverted === true && rule.conditions)
			.map((rule) => rule.conditions as object);

		if (hasUnconditionalCan && cannotConditions.length === 0) {
			return { drizzleFilter: undefined, searchFilter: undefined }; // Full access
		}
		let query = rulesToQuery(ability, action, resourceType, (rule) => rule.conditions);

		if (hasUnconditionalCan && cannotConditions.length > 0) {
			// If there's a broad `can` rule, the final query should be an AND of all
			// the `cannot` conditions, effectively excluding them.
			const andConditions = cannotConditions.map((condition) => {
				const newCondition: Record<string, any> = {};
				for (const key in condition) {
					newCondition[key] = { $ne: (condition as any)[key] };
				}
				return newCondition;
			});
			query = { $and: andConditions };
		}

		if (query === null) {
			return { drizzleFilter: undefined, searchFilter: undefined }; // Full access
		}

		if (Object.keys(query).length === 0) {
			return { drizzleFilter: sql`1=0`, searchFilter: 'ingestionSourceId = "-1"' }; // No access
		}
		return { drizzleFilter: mongoToDrizzle(query), searchFilter: await mongoToMeli(query) };
	}
}
