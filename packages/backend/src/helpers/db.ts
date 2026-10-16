// URL already percent-encodes the password; decode it first so it is not encoded twice.
// A '%' that does not start a valid escape is kept as typed.
const decodePassword = (password: string): string => {
	try {
		return decodeURIComponent(password);
	} catch {
		return password;
	}
};

export const encodeDatabaseUrl = (databaseUrl: string): string => {
	try {
		const url = new URL(databaseUrl);
		if (url.password) {
			url.password = encodeURIComponent(decodePassword(url.password));
		}
		return url.toString();
	} catch (error) {
		console.error('Invalid DATABASE_URL, please check your .env file.', error);
		throw new Error('Invalid DATABASE_URL');
	}
};
