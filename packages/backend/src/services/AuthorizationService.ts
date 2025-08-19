import { IamService } from './IamService';
import { db } from '../database';
import { ingestionSources } from '../database/schema/ingestion-sources';
import { eq } from 'drizzle-orm';

export class AuthorizationService {
    public static async can(userId: string, action: string, resource: string): Promise<boolean> {
        const iamService = new IamService();
        const userRoles = await iamService.getRolesForUser(userId);
        const allPolicies = userRoles.flatMap((role) => role.policies || []);

        // 1. Check for explicit DENY policies first.
        const isDenied = allPolicies.some(
            (policy) =>
                policy.Effect === 'Deny' &&
                this.matches(action, policy.Action) &&
                this.matches(resource, policy.Resource)
        );

        if (isDenied) {
            return false;
        }

        // 2. If not denied, check for an explicit ALLOW policy.
        for (const policy of allPolicies) {
            if (policy.Effect === 'Allow' && this.matches(action, policy.Action)) {
                if (action.includes('create')) {
                    return true;
                }

                if (this.matches(resource, policy.Resource)) {
                    return true
                }
            }
        }

        return false;
    }

    private static matches(value: string, patterns: string[]): boolean {
        return patterns.some((pattern) => {
            if (pattern === '*') return true;
            if (pattern.endsWith('*')) {
                const prefix = pattern.slice(0, -1);
                return value.startsWith(prefix);
            }
            const regex = new RegExp(`^${pattern.replace(/\{[^}]+\}/g, '[^/]+')}$`);
            return regex.test(value);
        });
    }

    private static async isOwner(userId: string, resource: string): Promise<boolean> {
        const resourceParts = resource.split('/');
        const service = resourceParts[0];
        const resourceId = resourceParts[1];

        if (service === 'ingestion-source' && resourceId) {
            if (resourceId === 'own') return true;
            const [source] = await db
                .select()
                .from(ingestionSources)
                .where(eq(ingestionSources.id, resourceId));
            return source?.userId === userId;
        }

        if (service === 'archive' && resourceParts[1] === 'ingestion-source' && resourceParts[2]) {
            const ingestionSourceId = resourceParts[2];
            const [source] = await db
                .select()
                .from(ingestionSources)
                .where(eq(ingestionSources.id, ingestionSourceId));
            return source?.userId === userId;
        }

        return false;
    }
}
