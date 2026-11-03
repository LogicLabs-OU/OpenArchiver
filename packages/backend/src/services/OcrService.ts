import crypto from 'crypto';
import { logger } from '../config/logger';
import { intFromEnv } from '../helpers/intFromEnv';
import { parseTikaMajor, tikaRequestShape } from '../helpers/tikaVersion';

/**
 * A Tika major version to use without asking the server, for a `/version` endpoint a proxy hides.
 * 0 (the default when unset) means detect. Read once: `intFromEnv` warns about an unusable value,
 * and once per process is the right number of times to hear that.
 */
const FORCED_TIKA_MAJOR = intFromEnv('TIKA_API_VERSION', 0, 3, 4);

// Simple LRU cache for Tika results with statistics
class TikaCache {
	private cache = new Map<string, string>();
	private maxSize = 50;
	private hits = 0;
	private misses = 0;

	get(key: string): string | undefined {
		const value = this.cache.get(key);
		if (value !== undefined) {
			this.hits++;
			// LRU: Move element to the end
			this.cache.delete(key);
			this.cache.set(key, value);
		} else {
			this.misses++;
		}
		return value;
	}

	set(key: string, value: string): void {
		// If already exists, delete first
		if (this.cache.has(key)) {
			this.cache.delete(key);
		}
		// If cache is full, remove oldest element
		else if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}

		this.cache.set(key, value);
	}

	getStats(): { size: number; maxSize: number; hits: number; misses: number; hitRate: number } {
		const total = this.hits + this.misses;
		const hitRate = total > 0 ? (this.hits / total) * 100 : 0;
		return {
			size: this.cache.size,
			maxSize: this.maxSize,
			hits: this.hits,
			misses: this.misses,
			hitRate: Math.round(hitRate * 100) / 100, // 2 decimal places
		};
	}

	reset(): void {
		this.cache.clear();
		this.hits = 0;
		this.misses = 0;
	}
}

// Semaphore for running Tika requests
class TikaSemaphore {
	private inProgress = new Map<string, Promise<string>>();
	private waitCount = 0;

	async acquire(key: string, operation: () => Promise<string>): Promise<string> {
		// Check if a request for this key is already running
		const existingPromise = this.inProgress.get(key);
		if (existingPromise) {
			this.waitCount++;
			logger.debug(`Waiting for in-progress Tika request (${key.slice(0, 8)}...)`);
			try {
				return await existingPromise;
			} finally {
				this.waitCount--;
			}
		}

		// Start new request
		const promise = this.executeOperation(key, operation);
		this.inProgress.set(key, promise);

		try {
			return await promise;
		} finally {
			// Remove promise from map when finished
			this.inProgress.delete(key);
		}
	}

	private async executeOperation(key: string, operation: () => Promise<string>): Promise<string> {
		try {
			return await operation();
		} catch (error) {
			// Remove promise from map even on errors
			logger.error(`Tika operation failed for key ${key.slice(0, 8)}...`, error);
			throw error;
		}
	}

	getStats(): { inProgress: number; waitCount: number } {
		return {
			inProgress: this.inProgress.size,
			waitCount: this.waitCount,
		};
	}

	clear(): void {
		this.inProgress.clear();
		this.waitCount = 0;
	}
}

export class OcrService {
	private tikaCache = new TikaCache();
	private tikaSemaphore = new TikaSemaphore();

	/**
	 * The server's major version per TIKA_URL, or when the last probe failed. Static on purpose:
	 * the answer belongs to the server, not to any one instance, and textExtractor builds a new
	 * OcrService per attachment.
	 */
	private static readonly majorByUrl = new Map<
		string,
		{ major: number } | { failedAt: number }
	>();

	/** How long a failed version probe is trusted before `/version` is asked again. */
	private static readonly VERSION_RECHECK_MS = 60_000;

	/** The version assumed while the server cannot be asked: the one compose.yaml ships. */
	private static readonly DEFAULT_MAJOR = 4;

	/**
	 * The base URLs to try, in order. With the compose hostname `tika`, `localhost` is tried as
	 * well, for the case where that name does not resolve from where this process runs.
	 */
	private tikaBaseUrls(tikaUrl: string): string[] {
		return [
			tikaUrl,
			...(tikaUrl.includes('://tika:') ? [tikaUrl.replace('://tika:', '://localhost:')] : []),
		];
	}

	/**
	 * Which Tika API to speak to the server at `tikaUrl`.
	 *
	 * `TIKA_API_VERSION` wins when set. Otherwise `/version` is asked once and the answer kept for
	 * the process; a server that does not answer is treated as the bundled 4.x and asked again
	 * after VERSION_RECHECK_MS, so an outage costs one probe a minute rather than one per attachment.
	 */
	private async resolveTikaMajor(tikaUrl: string): Promise<number> {
		if (FORCED_TIKA_MAJOR !== 0) {
			return FORCED_TIKA_MAJOR;
		}

		const known = OcrService.majorByUrl.get(tikaUrl);
		if (known && 'major' in known) {
			return known.major;
		}
		if (known && Date.now() - known.failedAt < OcrService.VERSION_RECHECK_MS) {
			return OcrService.DEFAULT_MAJOR;
		}

		for (const baseUrl of this.tikaBaseUrls(tikaUrl)) {
			try {
				const response = await fetch(`${baseUrl}/version`, {
					method: 'GET',
					signal: AbortSignal.timeout(5000),
				});
				if (!response.ok) {
					continue;
				}
				const major = this.rememberTikaVersion(tikaUrl, await response.text());
				if (major !== undefined) {
					return major;
				}
			} catch (error) {
				logger.debug({ err: error, baseUrl }, 'Tika version probe failed');
			}
		}

		OcrService.majorByUrl.set(tikaUrl, { failedAt: Date.now() });
		logger.warn(
			{ tikaUrl, assumedMajor: OcrService.DEFAULT_MAJOR },
			'Could not read the Tika version, assuming 4.x until the server answers'
		);
		return OcrService.DEFAULT_MAJOR;
	}

	/** Records the major version from a `/version` answer; undefined when it is not one. */
	private rememberTikaVersion(tikaUrl: string, versionText: string): number | undefined {
		const major = parseTikaMajor(versionText);
		if (major === undefined) {
			logger.warn(
				{ tikaUrl, versionText: versionText.trim() },
				'Unrecognised Tika version string'
			);
			return undefined;
		}
		OcrService.majorByUrl.set(tikaUrl, { major });
		logger.info(
			{ tikaUrl, version: versionText.trim(), endpoint: tikaRequestShape(major).endpoint },
			'Tika server version detected'
		);
		return major;
	}

	// Tika-based text extraction with cache and semaphore
	async extractTextWithTika(buffer: Buffer, mimeType: string): Promise<string> {
		const tikaUrl = process.env.TIKA_URL;
		if (!tikaUrl) {
			throw new Error('TIKA_URL environment variable not set');
		}

		// Cache key: SHA-256 hash of the buffer
		const hash = crypto.createHash('sha256').update(buffer).digest('hex');

		// Cache lookup (before semaphore!)
		const cachedResult = this.tikaCache.get(hash);
		if (cachedResult !== undefined) {
			logger.debug(`Tika cache hit for ${mimeType} (${buffer.length} bytes)`);
			return cachedResult;
		}

		// Use semaphore to deduplicate parallel requests
		return await this.tikaSemaphore.acquire(hash, async () => {
			// Check cache again (might have been filled by parallel request)
			const cachedAfterWait = this.tikaCache.get(hash);
			if (cachedAfterWait !== undefined) {
				logger.debug(`Tika cache hit after wait for ${mimeType} (${buffer.length} bytes)`);
				return cachedAfterWait;
			}

			logger.debug(`Executing Tika request for ${mimeType} (${buffer.length} bytes)`);

			// Tika 4.x no longer routes /tika on the Accept header (bare /tika returns Markdown)
			// and serves plain text from /tika/text, which on 3.x is the JSON endpoint. The
			// server's own version decides which request it gets.
			const shape = tikaRequestShape(await this.resolveTikaMajor(tikaUrl));
			const urlsToTry = this.tikaBaseUrls(tikaUrl).map(
				(baseUrl) => `${baseUrl}${shape.endpoint}`
			);

			// Set when a failure may succeed on a later attempt (server busy, network error),
			// so the empty result is not cached.
			let transientFailure = false;

			for (const url of urlsToTry) {
				try {
					logger.debug(`Trying Tika URL: ${url}`);
					const response = await this.putWithBackpressureRetry(
						url,
						buffer,
						mimeType,
						shape.accept
					);

					// 422: Tika 4.x returns the partially extracted content when the parser hit a
					// document-level exception (e.g. a malformed or encrypted file). On 3.x the
					// body is the parser's error, so there it is a failure like any other.
					if (response.status === 422 && shape.partialContentOn422) {
						logger.warn(
							`Tika reported a parse exception for ${mimeType} (${buffer.length} bytes); using partial content`
						);
					} else if (!response.ok) {
						// Tika 4.x error bodies are JSON: {"status": "...", "message": "..."}
						const tikaStatus = await this.readTikaErrorStatus(response);
						logger.warn(
							`Tika extraction failed at ${url}: ${response.status} ${response.statusText}${tikaStatus ? ` (${tikaStatus})` : ''}`
						);
						// 429 = all forks busy even after retries; worth trying again later.
						if (response.status === 429) {
							transientFailure = true;
						}
						continue; // Try next URL
					}

					const text = await response.text();
					const result = text.trim();

					// Cache result (also empty strings to avoid repeated attempts)
					this.tikaCache.set(hash, result);

					const cacheStats = this.tikaCache.getStats();
					const semaphoreStats = this.tikaSemaphore.getStats();
					logger.debug(
						`Tika extraction successful - Cache: ${cacheStats.hits}H/${cacheStats.misses}M (${cacheStats.hitRate}%) - Semaphore: ${semaphoreStats.inProgress} active, ${semaphoreStats.waitCount} waiting`
					);

					return result;
				} catch (error) {
					logger.warn(
						`Tika extraction error at ${url}:`,
						error instanceof Error ? error.message : 'Unknown error'
					);
					transientFailure = true;
					// Continue to next URL
				}
			}

			logger.error('All Tika URLs failed');
			// Cache definitive failures only, so a busy or unreachable server is retried later
			if (!transientFailure) {
				this.tikaCache.set(hash, '');
			}
			return '';
		});
	}

	// Maximum number of retries when Tika answers 429 (all forked parsers busy)
	private static readonly MAX_BACKPRESSURE_RETRIES = 3;
	// Upper bound for a single Retry-After wait
	private static readonly MAX_RETRY_AFTER_MS = 30000;

	/**
	 * PUTs the document to Tika. Tika 4.x parses in a fixed pool of forked JVMs and answers
	 * 429 with a Retry-After header when no fork is free; those responses are retried here.
	 *
	 * @param accept Sent as the `Accept` header when given. Tika 3.x chooses its output by it;
	 *   4.x ignores it and the path decides, so the caller leaves it out there.
	 */
	private async putWithBackpressureRetry(
		url: string,
		buffer: Buffer,
		mimeType: string,
		accept?: string
	): Promise<Response> {
		for (let attempt = 0; ; attempt++) {
			const response = await fetch(url, {
				method: 'PUT',
				headers: {
					// Tika 4.x treats this as a soft hint refined by content-based detection
					'Content-Type': mimeType || 'application/octet-stream',
					...(accept ? { Accept: accept } : {}),
					Connection: 'close',
				},
				body: buffer,
				signal: AbortSignal.timeout(180000),
			});

			if (response.status !== 429 || attempt >= OcrService.MAX_BACKPRESSURE_RETRIES) {
				return response;
			}

			const retryAfterSeconds = Number(response.headers.get('Retry-After'));
			const waitMs = Math.min(
				Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
					? retryAfterSeconds * 1000
					: 1000 * 2 ** attempt,
				OcrService.MAX_RETRY_AFTER_MS
			);
			// Drain the body so the connection can be released
			await response.body?.cancel();
			logger.debug(
				`Tika busy (429), retrying in ${waitMs}ms (attempt ${attempt + 1}/${OcrService.MAX_BACKPRESSURE_RETRIES})`
			);
			await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
	}

	// Extracts the "status" field from a Tika 4.x JSON error body, if present
	private async readTikaErrorStatus(response: Response): Promise<string | undefined> {
		try {
			const body = (await response.json()) as { status?: unknown };
			return typeof body.status === 'string' ? body.status : undefined;
		} catch {
			return undefined;
		}
	}

	// Helper function to check Tika availability
	async checkTikaAvailability(): Promise<boolean> {
		const tikaUrl = process.env.TIKA_URL;
		if (!tikaUrl) {
			return false;
		}

		try {
			const response = await fetch(`${tikaUrl}/version`, {
				method: 'GET',
				signal: AbortSignal.timeout(5000), // 5 seconds timeout
			});

			if (response.ok) {
				const version = await response.text();
				logger.info(`Tika server available, version: ${version.trim()}`);
				// The answer is in hand, so the first extraction need not ask again.
				this.rememberTikaVersion(tikaUrl, version);
				return true;
			}

			return false;
		} catch (error) {
			logger.warn(
				'Tika server not available:',
				error instanceof Error ? error.message : 'Unknown error'
			);
			return false;
		}
	}

	// Optional: Tika health check on startup
	async initializeTextExtractor(): Promise<void> {
		const tikaUrl = process.env.TIKA_URL;

		if (tikaUrl) {
			const isAvailable = await this.checkTikaAvailability();
			if (!isAvailable) {
				logger.error(`Tika server configured but not available at: ${tikaUrl}`);
				logger.error('Text extraction will fall back to legacy methods or fail');
			}
		} else {
			logger.info('Using legacy text extraction methods (pdf2json, mammoth, xlsx)');
			logger.info(
				'Set TIKA_URL environment variable to use Apache Tika for better extraction'
			);
		}
	}

	// Get cache statistics
	getTikaCacheStats(): {
		size: number;
		maxSize: number;
		hits: number;
		misses: number;
		hitRate: number;
	} {
		return this.tikaCache.getStats();
	}

	// Get semaphore statistics
	getTikaSemaphoreStats(): { inProgress: number; waitCount: number } {
		return this.tikaSemaphore.getStats();
	}

	// Clear cache (e.g. for tests or manual reset)
	clearTikaCache(): void {
		this.tikaCache.reset();
		this.tikaSemaphore.clear();
		logger.info('Tika cache and semaphore cleared');
	}
}
