import { SQL, sql } from 'drizzle-orm';
import { IamService } from './IamService';
import { rulesToQuery } from '@casl/ability/extra';
import { mongoToDrizzle } from '../helpers/mongoToDrizzle';
import { mongoToMeli } from '../helpers/mongoToMeli';
import { AppActions, AppSubjects } from '@open-archiver/types';
import type { AppAbility } from '../iam-policy/ability';

export interface AccessFilter {
	/** undefined means "no restriction"; a `1=0` clause means "nothing is visible". */
	drizzleFilter: SQL | undefined;
	/** undefined means "no restriction"; a never-matching filter means "nothing is visible". */
	searchFilter: string | undefined;
}

/** The row filter for a user who may see everything of this type. */
const ALLOW_ALL: AccessFilter = { drizzleFilter: undefined, searchFilter: undefined };

/**
 * The row filter for a user who may see nothing. `ingestionSourceId` is a UUID column, so the
 * literal `-1` matches no document.
 */
const denyAll = (): AccessFilter => ({
	drizzleFilter: sql`1=0`,
	searchFilter: 'ingestionSourceId = "-1"',
});

/** What a single action's rules permit, before the actions are combined. */
type ActionAccess =
	| { kind: 'all' }
	| { kind: 'none' }
	| { kind: 'conditions'; query: Record<string, any> };

/**
 * Turns a rule into the condition object the query translators consume.
 *
 * An inverted rule forbids the rows its conditions describe, so it has to be negated. CASL's
 * `rulesToQuery` collects inverted rules into `$and` and non-inverted ones into `$or`; without the
 * `$not` an inverted rule would be applied as a positive requirement, i.e. exactly backwards.
 */
const toCondition = (rule: { inverted: boolean; conditions?: any }): Record<string, any> =>
	rule.inverted ? { $not: rule.conditions } : rule.conditions;

export class FilterBuilder {
	/**
	 * Builds the database and search-engine filters that restrict a listing to the rows a user is
	 * allowed to see.
	 *
	 * Pass every action the calling route accepts. The result is the union of what those actions
	 * permit, which matches how the route itself decided to let the request through: a role that
	 * may `search` the archive should see the rows its `search` rules describe, even if it holds no
	 * `read` rule at all.
	 */
	public static async create(
		userId: string,
		resourceType: AppSubjects,
		actions: AppActions | AppActions[]
	): Promise<AccessFilter> {
		const iamService = new IamService();
		const ability = await iamService.getAbilityForUser(userId);

		const perAction = (Array.isArray(actions) ? actions : [actions]).map((action) =>
			this.#accessFor(ability, resourceType, action)
		);

		// One unrestricted action is enough: the union of "everything" with anything else is
		// still everything.
		if (perAction.some((access) => access.kind === 'all')) {
			return ALLOW_ALL;
		}

		const conditional = perAction.filter(
			(access): access is { kind: 'conditions'; query: Record<string, any> } =>
				access.kind === 'conditions'
		);
		if (conditional.length === 0) {
			return denyAll();
		}

		const query =
			conditional.length === 1
				? conditional[0].query
				: { $or: conditional.map((access) => access.query) };

		const drizzleFilter = mongoToDrizzle(query);
		const searchFilter = await mongoToMeli(query);

		// A restrictive permission query that compiles to nothing would read as "no restriction"
		// at the call sites, so deny instead of handing out full access.
		if (!drizzleFilter || searchFilter === '') {
			return denyAll();
		}

		return { drizzleFilter, searchFilter };
	}

	/**
	 * What a single action permits.
	 *
	 * `rulesToQuery` returns `{}` when an unconditional `can` rule makes the whole set
	 * unrestricted, and `null` when nothing is allowed. An empty rule list never reaches it, and
	 * would also produce `null` — so the two "nothing" cases are folded together here rather than
	 * being read as full access.
	 */
	static #accessFor(
		ability: AppAbility,
		resourceType: AppSubjects,
		action: AppActions
	): ActionAccess {
		if (ability.rulesFor(action, resourceType).length === 0) {
			return { kind: 'none' };
		}

		const query = rulesToQuery(ability, action, resourceType, toCondition);
		if (query === null) {
			return { kind: 'none' };
		}
		if (Object.keys(query).length === 0) {
			return { kind: 'all' };
		}
		return { kind: 'conditions', query: query as Record<string, any> };
	}
}
