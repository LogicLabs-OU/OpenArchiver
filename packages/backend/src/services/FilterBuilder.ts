import { SQL, or, and, eq, inArray, sql } from 'drizzle-orm';
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

        const canReadOwn = allowedResources.some((resource) => resource.endsWith('/own'));
        const sourceIds = allowedResources
            .map((resource) => resource.split('/')[1])
            .filter((id) => id !== 'own');

        const conditions: SQL[] = [];
        if (canReadOwn) {
            conditions.push(eq(this.table.userId, this.userId));
        }
        if (sourceIds.length > 0) {
            conditions.push(inArray(this.table.id, sourceIds));
        }

        if (conditions.length === 0) {
            return eq(this.table.id, sql`NULL`);
        }

        return or(...conditions);
    }
}
