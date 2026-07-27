export const encodeDatabaseUrl = (databaseUrl: string): string => {
	try {
		const url = new URL(databaseUrl);
		if (url.password) {
			url.password = encodeURIComponent(url.password);
		}
		return url.toString();
	} catch (error) {
		console.error('Invalid DATABASE_URL, please check your .env file.', error);
		throw new Error('Invalid DATABASE_URL');
	}
};

export const getDatabaseConfig = (drizzleConf: boolean = false): string | Record<string, any> => {
	if (process.env.DATABASE_URL) {
		return drizzleConf
			? {
					url: process.env.DATABASE_URL,
				}
			: encodeDatabaseUrl(process.env.DATABASE_URL);
	} else if (process.env.DATABASE_SOCKET) {
		return drizzleConf
			? {
					host: process.env.DATABASE_SOCKET,
					database: process.env.POSTGRES_DB,
					user: process.env.POSTGRES_USER,
					password: process.env.POSTGRES_PASSWORD,
				}
			: {
					host: process.env.DATABASE_SOCKET,
					database: process.env.POSTGRES_DB,
					username: process.env.POSTGRES_USER,
					password: process.env.POSTGRES_PASSWORD,
				};
	} else {
		throw new Error('Neither DATABASE_URL nor DATABASE_SOCKET is set in the .env file');
	}
};
