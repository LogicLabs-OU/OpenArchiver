function getMeliColumn(key: string): string {
    const keyParts = key.split('.');
    if (keyParts.length > 1) {
        const relationName = keyParts[0];
        const columnName = keyParts[1];
        return `${relationName}.${columnName}`;
    }
    return key;
}

export function mongoToMeli(query: Record<string, any>): string {
    const conditions: string[] = [];

    for (const key in query) {
        const value = query[key];

        if (key === '$or') {
            conditions.push(`(${value.map(mongoToMeli).join(' OR ')})`);
            continue;
        }

        if (key === '$and') {
            conditions.push(`(${value.map(mongoToMeli).join(' AND ')})`);
            continue;
        }

        if (key === '$not') {
            conditions.push(`NOT (${mongoToMeli(value)})`);
            continue;
        }

        const column = getMeliColumn(key);

        if (typeof value === 'object' && value !== null) {
            const operator = Object.keys(value)[0];
            const operand = value[operator];

            switch (operator) {
                case '$eq':
                    conditions.push(`${column} = ${operand}`);
                    break;
                case '$ne':
                    conditions.push(`${column} != ${operand}`);
                    break;
                case '$gt':
                    conditions.push(`${column} > ${operand}`);
                    break;
                case '$gte':
                    conditions.push(`${column} >= ${operand}`);
                    break;
                case '$lt':
                    conditions.push(`${column} < ${operand}`);
                    break;
                case '$lte':
                    conditions.push(`${column} <= ${operand}`);
                    break;
                case '$in':
                    conditions.push(`${column} IN [${operand.join(', ')}]`);
                    break;
                case '$nin':
                    conditions.push(`${column} NOT IN [${operand.join(', ')}]`);
                    break;
                case '$exists':
                    conditions.push(`${column} ${operand ? 'EXISTS' : 'NOT EXISTS'}`);
                    break;
                default:
                // Unsupported operator
            }
        } else {
            conditions.push(`${column} = ${value}`);
        }
    }

    return conditions.join(' AND ');
}
