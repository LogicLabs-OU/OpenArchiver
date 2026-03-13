import fs from 'fs';
import path from 'path';

interface VersionCache {
	newVersionInfo: { version: string; description: string; url: string } | null;
	lastChecked: string | null;
}

const CACHE_FILE = path.join(process.cwd(), '.version-cache.json');

export function loadVersionCache(): VersionCache {
	try {
		if (fs.existsSync(CACHE_FILE)) {
			const data = fs.readFileSync(CACHE_FILE, 'utf8');
			return JSON.parse(data);
		}
	} catch (error) {
		console.warn('Failed to load version cache:', error);
	}

	return {
		newVersionInfo: null,
		lastChecked: null,
	};
}

export function saveVersionCache(cache: VersionCache): void {
	try {
		fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
	} catch (error) {
		console.warn('Failed to save version cache:', error);
	}
}
