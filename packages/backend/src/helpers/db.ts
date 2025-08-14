export const encodeDatabaseUrl = (databaseUrl: string): string => {
    try {
        const url = new URL(databaseUrl);
        if (url.password) {
            url.password = encodeURIComponent(url.password);
        }
        return url.toString();
    } catch (error) {
        console.error("Invalid DATABASE_URL, please check your .env file.", error);
        throw new Error("Invalid DATABASE_URL");
    }
};
