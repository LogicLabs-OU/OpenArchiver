import { db } from '../database';
import { ingestionSources } from '../database/schema';
import { eq } from 'drizzle-orm';
const snakeToCamelCase = (str: string): string => {
	return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
};

function getMeliColumn(key: string): string {
	const keyParts = key.split('.');
	if (keyParts.length > 1) {
		const relationName = keyParts[0];
		const columnName = keyParts[1];
		return `${relationName}.${columnName}`;
	}
	return snakeToCamelCase(key);
}

function quoteIfString(value: any): any {
	if (typeof value === 'string') {
		return `"${value}"`;
	}
	return value;
}

export async function mongoToMeli(query: Record<string, any>): Promise<string> {
	const conditions: string[] = [];
	for (const key of Object.keys(query)) {
		const value = query[key];

		if (key === '$or') {
			const orConditions = await Promise.all(value.map(mongoToMeli));
			conditions.push(`(${orConditions.join(' OR ')})`);
			continue;
		}

		if (key === '$and') {
			const andConditions = await Promise.all(value.map(mongoToMeli));
			conditions.push(`(${andConditions.join(' AND ')})`);
			continue;
		}

		if (key === '$not') {
			conditions.push(`NOT (${await mongoToMeli(value)})`);
			continue;
		}

		const column = getMeliColumn(key);

		if (typeof value === 'object' && value !== null) {
			const operator = Object.keys(value)[0];
			const operand = value[operator];

			switch (operator) {
				case '$eq':
					conditions.push(`${column} = ${quoteIfString(operand)}`);
					break;
				case '$ne':
					conditions.push(`${column} != ${quoteIfString(operand)}`);
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
					conditions.push(`${column} IN [${operand.map(quoteIfString).join(', ')}]`);
					break;
				case '$nin':
					conditions.push(`${column} NOT IN [${operand.map(quoteIfString).join(', ')}]`);
					break;
				case '$exists':
					conditions.push(`${column} ${operand ? 'EXISTS' : 'NOT EXISTS'}`);
					break;
				default:
				// Unsupported operator
			}
		} else {
			if (column === 'ingestionSource.userId') {
				// for the userId placeholder. (Await for a more elegant solution)
				const ingestionsIds = await db
					.select({ id: ingestionSources.id })
					.from(ingestionSources)
					.where(eq(ingestionSources.userId, value));
				conditions.push(
					`ingestionSourceId IN [${ingestionsIds.map((i) => quoteIfString(i.id)).join(', ')}]`
				);
			} else {
				conditions.push(`${column} = ${quoteIfString(value)}`);
			}
		}
	}
	return conditions.join(' AND ');
}
