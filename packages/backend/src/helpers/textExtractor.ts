import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import { logger } from '../config/logger';
import crypto from 'crypto';

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
        const hitRate = total > 0 ? (this.hits / total * 100) : 0;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: Math.round(hitRate * 100) / 100 // 2 decimal places
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
            waitCount: this.waitCount
        };
    }

    clear(): void {
        this.inProgress.clear();
        this.waitCount = 0;
    }
}

// Globaler Cache und Semaphor
const tikaCache = new TikaCache();
const tikaSemaphore = new TikaSemaphore();

// Tika-based text extraction with cache and semaphore
async function extractTextWithTika(buffer: Buffer, mimeType: string): Promise<string> {
    const tikaUrl = process.env.TIKA_URL;
    if (!tikaUrl) {
        throw new Error('TIKA_URL environment variable not set');
    }

    // Cache key: SHA-256 hash of the buffer
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Cache lookup (before semaphore!)
    const cachedResult = tikaCache.get(hash);
    if (cachedResult !== undefined) {
        logger.debug(`Tika cache hit for ${mimeType} (${buffer.length} bytes)`);
        return cachedResult;
    }

    // Use semaphore to deduplicate parallel requests
    return await tikaSemaphore.acquire(hash, async () => {
        // Check cache again (might have been filled by parallel request)
        const cachedAfterWait = tikaCache.get(hash);
        if (cachedAfterWait !== undefined) {
            logger.debug(`Tika cache hit after wait for ${mimeType} (${buffer.length} bytes)`);
            return cachedAfterWait;
        }

        logger.debug(`Executing Tika request for ${mimeType} (${buffer.length} bytes)`);

        // DNS fallback: If "tika" hostname, also try localhost
        const urlsToTry = [
            `${tikaUrl}/tika`,
            // Fallback falls DNS-Problem mit "tika" hostname
            ...(tikaUrl.includes('://tika:') ? [`${tikaUrl.replace('://tika:', '://localhost:')}/tika`] : [])
        ];

        for (const url of urlsToTry) {
            try {
                logger.debug(`Trying Tika URL: ${url}`);
                const response = await fetch(url, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': mimeType || 'application/octet-stream',
                        'Accept': 'text/plain',
                        'Connection': 'close'
                    },
                    body: buffer,
                    signal: AbortSignal.timeout(180000)
                });

                if (!response.ok) {
                    logger.warn(`Tika extraction failed at ${url}: ${response.status} ${response.statusText}`);
                    continue; // Try next URL
                }

                const text = await response.text();
                const result = text.trim();

                // Cache result (also empty strings to avoid repeated attempts)
                tikaCache.set(hash, result);

                const cacheStats = tikaCache.getStats();
                const semaphoreStats = tikaSemaphore.getStats();
                logger.debug(`Tika extraction successful - Cache: ${cacheStats.hits}H/${cacheStats.misses}M (${cacheStats.hitRate}%) - Semaphore: ${semaphoreStats.inProgress} active, ${semaphoreStats.waitCount} waiting`);

                return result;
            } catch (error) {
                logger.warn(`Tika extraction error at ${url}:`, error instanceof Error ? error.message : 'Unknown error');
                // Continue to next URL
            }
        }

        // All URLs failed - cache this too (as empty string)
        logger.error('All Tika URLs failed');
        tikaCache.set(hash, '');
        return '';
    });
}

// Legacy PDF extraction (with improved memory management)
function extractTextFromPdf(buffer: Buffer): Promise<string> {
    return new Promise((resolve) => {
        const pdfParser = new PDFParser(null, true);
        let completed = false;

        const finish = (text: string) => {
            if (completed) return;
            completed = true;

            // explicit cleanup
            try {
                pdfParser.removeAllListeners();
            } catch (e) {
                // Ignore cleanup errors
            }

            resolve(text);
        };

        pdfParser.on('pdfParser_dataError', (err: any) => {
            logger.warn('PDF parsing error:', err?.parserError || 'Unknown error');
            finish('');
        });

        pdfParser.on('pdfParser_dataReady', () => {
            try {
                const text = pdfParser.getRawTextContent();
                finish(text || '');
            } catch (err) {
                logger.warn('Error getting PDF text content:', err);
                finish('');
            }
        });

        try {
            pdfParser.parseBuffer(buffer);
        } catch (err) {
            logger.error('Error parsing PDF buffer:', err);
            finish('');
        }

        // reduced Timeout for better performance
        setTimeout(() => {
            logger.warn('PDF parsing timed out');
            finish('');
        }, 5000);
    });
}

// Legacy text extraction for various formats
async function extractTextLegacy(buffer: Buffer, mimeType: string): Promise<string> {
    try {
        if (mimeType === 'application/pdf') {
            // Check PDF size (memory protection)
            if (buffer.length > 50 * 1024 * 1024) { // 50MB Limit
                logger.warn('PDF too large for legacy extraction, skipping');
                return '';
            }
            return await extractTextFromPdf(buffer);
        }

        if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const { value } = await mammoth.extractRawText({ buffer });
            return value;
        }

        if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            const workbook = xlsx.read(buffer, { type: 'buffer' });
            let fullText = '';
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const sheetText = xlsx.utils.sheet_to_txt(sheet);
                fullText += sheetText + '\n';
            }
            return fullText.trim();
        }

        if (
            mimeType.startsWith('text/') ||
            mimeType === 'application/json' ||
            mimeType === 'application/xml'
        ) {
            return buffer.toString('utf-8');
        }

        return '';
    } catch (error) {
        logger.error(`Error extracting text from attachment with MIME type ${mimeType}:`, error);

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }

        return '';
    }
}

// Main extraction function
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
    // Input validation
    if (!buffer || buffer.length === 0) {
        return '';
    }

    if (!mimeType) {
        logger.warn('No MIME type provided for text extraction');
        return '';
    }

    // General size limit
    const maxSize = process.env.TIKA_URL ? 100 * 1024 * 1024 : 50 * 1024 * 1024; // 100MB for Tika, 50MB for Legacy
    if (buffer.length > maxSize) {
        logger.warn(`File too large for text extraction: ${buffer.length} bytes (limit: ${maxSize})`);
        return '';
    }

    // Decide between Tika and legacy
    const tikaUrl = process.env.TIKA_URL;

    if (tikaUrl) {
        // Tika decides what it can parse (including OCR for images!)
        logger.debug(`Using Tika for text extraction: ${mimeType}`);
        return await extractTextWithTika(buffer, mimeType);
    } else {
        // Only filter MIME types in legacy mode
        const unsupportedTypes = ['image/', 'video/', 'audio/'];
        if (unsupportedTypes.some(type => mimeType.startsWith(type))) {
            logger.warn(`Unsupported MIME type for legacy extraction: ${mimeType}`);
            return '';
        }
        logger.debug(`Using legacy extraction for: ${mimeType}`);
        const result = await extractTextLegacy(buffer, mimeType);

        if (!result && mimeType !== 'application/pdf') {
            logger.warn(`Unsupported MIME type for text extraction: ${mimeType}`);
        }

        return result;
    }
}

// Helper function to check Tika availability
export async function checkTikaAvailability(): Promise<boolean> {
    const tikaUrl = process.env.TIKA_URL;
    if (!tikaUrl) {
        return false;
    }

    try {
        const response = await fetch(`${tikaUrl}/version`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000) // 5 seconds timeout
        });

        if (response.ok) {
            const version = await response.text();
            logger.info(`Tika server available, version: ${version.trim()}`);
            return true;
        }

        return false;
    } catch (error) {
        logger.warn('Tika server not available:', error instanceof Error ? error.message : 'Unknown error');
        return false;
    }
}

// Optional: Tika health check on startup
export async function initializeTextExtractor(): Promise<void> {
    const tikaUrl = process.env.TIKA_URL;

    if (tikaUrl) {
        const isAvailable = await checkTikaAvailability();
        if (!isAvailable) {
            logger.error(`Tika server configured but not available at: ${tikaUrl}`);
            logger.error('Text extraction will fall back to legacy methods or fail');
        }
    } else {
        logger.info('Using legacy text extraction methods (pdf2json, mammoth, xlsx)');
        logger.info('Set TIKA_URL environment variable to use Apache Tika for better extraction');
    }
}

// Get cache statistics
export function getTikaCacheStats(): { size: number; maxSize: number; hits: number; misses: number; hitRate: number } {
    return tikaCache.getStats();
}

// Get semaphore statistics
export function getTikaSemaphoreStats(): { inProgress: number; waitCount: number } {
    return tikaSemaphore.getStats();
}

// Clear cache (e.g. for tests or manual reset)
export function clearTikaCache(): void {
    tikaCache.reset();
    tikaSemaphore.clear();
    logger.info('Tika cache and semaphore cleared');
}
