import { SQL, or, and, eq, inArray } from 'drizzle-orm';
import { PgTableWithColumns } from 'drizzle-orm/pg-core';
import { IamService } from './IamService';

export class FilterBuilder {
    private constructor(
        private userId: string,
        private table: PgTableWithColumns<any>,
        private policies: any[],
        private resourceType: string,
        private readAction: string
    ) { }

    public static async create(
        userId: string,
        table: PgTableWithColumns<any>,
        resourceType: string,
        readAction: string
    ): Promise<FilterBuilder> {
        const iamService = new IamService();
        const userRoles = await iamService.getRolesForUser(userId);
        const allPolicies = userRoles.flatMap((role) => role.policies || []);
        return new FilterBuilder(userId, table, allPolicies, resourceType, readAction);
    }

    public build(): SQL | undefined {
        const canReadAll = this.policies.some(
            (policy) =>
                policy.Effect === 'Allow' &&
                (policy.Action.includes(this.readAction) || policy.Action.includes('*')) &&
                (policy.Resource.includes(`${this.resourceType}/*`) ||
                    policy.Resource.includes('*'))
        );

        if (canReadAll) {
            return undefined;
        }

        const allowedResources = this.policies
            .filter(
                (policy) =>
                    policy.Effect === 'Allow' &&
                    (policy.Action.includes(this.readAction) || policy.Action.includes('*'))
            )
            .flatMap((policy) => policy.Resource)
            .filter((resource) => resource.startsWith(`${this.resourceType}/`));

        const sourceIds = allowedResources.map((resource) => resource.split('/')[1]);

        return or(
            eq(this.table.userId, this.userId),
            sourceIds.length > 0 ? inArray(this.table.id, sourceIds) : undefined
        );
    }
}
