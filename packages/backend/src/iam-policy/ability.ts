// packages/backend/src/iam-policy/ability.ts
import { createMongoAbility, MongoAbility, RawRuleOf } from '@casl/ability';
import { CaslPolicy, AppActions, AppSubjects } from '@open-archiver/types';
import { ingestionSources, archivedEmails, users, roles } from '../database/schema';
import { InferSelectModel } from 'drizzle-orm';

// Define the application's ability type
export type AppAbility = MongoAbility<[AppActions, AppSubjects]>;

// Helper type for raw rules
export type AppRawRule = RawRuleOf<AppAbility>;

// Represents the possible object types that can be passed as subjects for permission checks.
export type SubjectObject =
	| InferSelectModel<typeof ingestionSources>
	| InferSelectModel<typeof archivedEmails>
	| InferSelectModel<typeof users>
	| InferSelectModel<typeof roles>
	| AppSubjects;
/**
 * Translates conditions on an 'ingestion' subject to equivalent conditions on an 'archive' subject.
 * This is used to implement inherent permissions, where permission on an ingestion source
 * implies permission on the emails it has ingested.
 * @param conditions The original conditions object for the 'ingestion' subject.
 * @returns A new conditions object for the 'archive' subject.
 */
function translateIngestionConditionsToArchive(
	conditions: Record<string, any>
): Record<string, any> {
	if (!conditions || typeof conditions !== 'object') {
		return conditions;
	}

	const translated: Record<string, any> = {};
	for (const key in conditions) {
		const value = conditions[key];

		// Handle logical operators recursively
		if (['$or', '$and', '$nor'].includes(key) && Array.isArray(value)) {
			translated[key] = value.map((v) => translateIngestionConditionsToArchive(v));
			continue;
		}
		if (key === '$not' && typeof value === 'object' && value !== null) {
			translated[key] = translateIngestionConditionsToArchive(value);
			continue;
		}

		// Translate field names
		let newKey = key;
		if (key === 'id') {
			newKey = 'ingestionSourceId';
		} else if (['userId', 'name', 'provider', 'status'].includes(key)) {
			newKey = `ingestionSource.${key}`;
		}

		translated[newKey] = value;
	}
	return translated;
}

/**
 * Expands the given set of policies to include inherent permissions.
 * For example, a permission on an 'ingestion' source is expanded to grant
 * the same permission on 'archive' records related to that source.
 * @param policies The original array of CASL policies.
 * @returns A new array of policies including the expanded, inherent permissions.
 */
function expandPolicies(policies: CaslPolicy[]): CaslPolicy[] {
	const expandedPolicies: CaslPolicy[] = JSON.parse(JSON.stringify(policies));

	policies.forEach((policy) => {
		if (policy.subject === 'ingestion') {
			const archivePolicy: CaslPolicy = {
				...JSON.parse(JSON.stringify(policy)),
				subject: 'archive',
			};
			if (policy.conditions) {
				archivePolicy.conditions = translateIngestionConditionsToArchive(policy.conditions);
			}
			expandedPolicies.push(archivePolicy);
		}
	});

	return expandedPolicies;
}

// Function to create an ability instance from policies stored in the database
export function createAbilityFor(policies: CaslPolicy[]) {
	const allPolicies = expandPolicies(policies);

	return createMongoAbility<AppAbility>(allPolicies as AppRawRule[]);
}
