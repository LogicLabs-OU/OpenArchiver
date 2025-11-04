import { SQL, and, or, not, eq, gt, gte, lt, lte, inArray, isNull, sql } from 'drizzle-orm';

const camelToSnakeCase = (str: string) =>
	str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const relationToTableMap: Record<string, string> = {
	ingestionSource: 'ingestion_sources',
	// TBD: Add other relations here as needed
};

function getDrizzleColumn(key: string): SQL {
	const keyParts = key.split('.');
	if (keyParts.length > 1) {
		const relationName = keyParts[0];
		const columnName = camelToSnakeCase(keyParts[1]);
		const tableName = relationToTableMap[relationName];
		if (tableName) {
			return sql.raw(`"${tableName}"."${columnName}"`);
		}
	}
	return sql`${sql.identifier(camelToSnakeCase(key))}`;
}

export function mongoToDrizzle(query: Record<string, any>): SQL | undefined {
	const conditions: (SQL | undefined)[] = [];

	for (const key in query) {
		const value = query[key];

		if (key === '$or') {
			conditions.push(or(...(value as any[]).map(mongoToDrizzle).filter(Boolean)));
			continue;
		}

		if (key === '$and') {
			conditions.push(and(...(value as any[]).map(mongoToDrizzle).filter(Boolean)));
			continue;
		}

		if (key === '$not') {
			const subQuery = mongoToDrizzle(value);
			if (subQuery) {
				conditions.push(not(subQuery));
			}
			continue;
		}

		const column = getDrizzleColumn(key);

        // Handle case-insensitive comparison for email fields.
        const keyLower = key.replace(/\./g, '').toLowerCase();
        if (keyLower === 'useremail') {
            // Normalize comparison for equality and inequality
            if (typeof value === 'object' && value !== null) {
                const operator = Object.keys(value)[0];
                const operand = (value as any)[operator];
                const lowerOperand =
                    typeof operand === 'string' ? operand.toLowerCase() : operand;
                switch (operator) {
                    case '$eq':
                        conditions.push(sql`lower(${column}) = ${lowerOperand}`);
                        break;
                    case '$ne':
                        conditions.push(not(sql`lower(${column}) = ${lowerOperand}`));
                        break;
                    case '$in':
                        if (Array.isArray(operand)) {
                            const lowerArray = operand.map((item: any) =>
                                typeof item === 'string' ? item.toLowerCase() : item,
                            );
                            conditions.push(inArray(sql`lower(${column})`, lowerArray));
                        }
                        break;
                    case '$nin':
                        if (Array.isArray(operand)) {
                            const lowerArray = operand.map((item: any) =>
                                typeof item === 'string' ? item.toLowerCase() : item,
                            );
                            conditions.push(not(inArray(sql`lower(${column})`, lowerArray)));
                        }
                        break;
                    default:
                        // For unsupported operators on userEmail fall back to simple equality
                        conditions.push(sql`lower(${column}) = ${lowerOperand}`);
                }
            } else {
                const lowerValue = typeof value === 'string' ? value.toLowerCase() : value;
                conditions.push(sql`lower(${column}) = ${lowerValue}`);
            }
            continue;
		}
		
		if (typeof value === 'object' && value !== null) {
			const operator = Object.keys(value)[0];
			const operand = value[operator];

			switch (operator) {
				case '$eq':
					conditions.push(eq(column, operand));
					break;
				case '$ne':
					conditions.push(not(eq(column, operand)));
					break;
				case '$gt':
					conditions.push(gt(column, operand));
					break;
				case '$gte':
					conditions.push(gte(column, operand));
					break;
				case '$lt':
					conditions.push(lt(column, operand));
					break;
				case '$lte':
					conditions.push(lte(column, operand));
					break;
				case '$in':
					conditions.push(inArray(column, operand));
					break;
				case '$nin':
					conditions.push(not(inArray(column, operand)));
					break;
				case '$exists':
					conditions.push(operand ? not(isNull(column)) : isNull(column));
					break;
				default:
				// Unsupported operator
			}
		} else {
			conditions.push(eq(column, value));
		}
	}

	if (conditions.length === 0) {
		return undefined;
	}

	return and(...conditions.filter((c): c is SQL => c !== undefined));
}
