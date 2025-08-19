import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import crypto from 'crypto';

// Einfacher LRU-Cache für Tika-Ergebnisse mit Statistiken
class TikaCache {
    private cache = new Map<string, string>();
    private maxSize = 50;
    private hits = 0;
    private misses = 0;

    get(key: string): string | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            this.hits++;
            // LRU: Element nach hinten verschieben
            this.cache.delete(key);
            this.cache.set(key, value);
        } else {
            this.misses++;
        }
        return value;
    }

    set(key: string, value: string): void {
        // Falls schon vorhanden, erstmal löschen
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        // Falls Cache voll, ältestes Element entfernen
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
            hitRate: Math.round(hitRate * 100) / 100 // 2 Dezimalstellen
        };
    }

    reset(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
}

// Semaphor für laufende Tika-Anfragen
class TikaSemaphore {
    private inProgress = new Map<string, Promise<string>>();
    private waitCount = 0;

    async acquire(key: string, operation: () => Promise<string>): Promise<string> {
        // Prüfen ob bereits eine Anfrage für diesen Key läuft
        const existingPromise = this.inProgress.get(key);
        if (existingPromise) {
            this.waitCount++;
            console.debug(`Waiting for in-progress Tika request (${key.slice(0, 8)}...)`);
            try {
                return await existingPromise;
            } finally {
                this.waitCount--;
            }
        }

        // Neue Anfrage starten
        const promise = this.executeOperation(key, operation);
        this.inProgress.set(key, promise);
        
        try {
            return await promise;
        } finally {
            // Promise aus der Map entfernen wenn fertig
            this.inProgress.delete(key);
        }
    }

    private async executeOperation(key: string, operation: () => Promise<string>): Promise<string> {
        try {
            return await operation();
        } catch (error) {
            // Auch bei Fehlern Promise aus Map entfernen
            console.error(`Tika operation failed for key ${key.slice(0, 8)}...`, error);
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

// Tika-basierte Text-Extraktion mit Cache und Semaphor
async function extractTextWithTika(buffer: Buffer, mimeType: string): Promise<string> {
    const tikaUrl = process.env.TIKA_URL;
    if (!tikaUrl) {
        throw new Error('TIKA_URL environment variable not set');
    }

    // Cache-Key: SHA-256 Hash des Buffers
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Cache-Lookup (vor Semaphor!)
    const cachedResult = tikaCache.get(hash);
    if (cachedResult !== undefined) {
        console.debug(`Tika cache hit for ${mimeType} (${buffer.length} bytes)`);
        return cachedResult;
    }

    // Semaphor verwenden um parallele Anfragen zu deduplizieren
    return await tikaSemaphore.acquire(hash, async () => {
        // Nochmal Cache prüfen (könnte durch parallele Anfrage gefüllt worden sein)
        const cachedAfterWait = tikaCache.get(hash);
        if (cachedAfterWait !== undefined) {
            console.debug(`Tika cache hit after wait for ${mimeType} (${buffer.length} bytes)`);
            return cachedAfterWait;
        }

        console.debug(`Executing Tika request for ${mimeType} (${buffer.length} bytes)`);

        // DNS-Fallback: Bei "tika" Hostname versuche auch localhost
        const urlsToTry = [
            `${tikaUrl}/tika`,
            // Fallback falls DNS-Problem mit "tika" hostname
            ...(tikaUrl.includes('://tika:') ? [`${tikaUrl.replace('://tika:', '://localhost:')}/tika`] : [])
        ];

        for (const url of urlsToTry) {
            try {
                console.debug(`Trying Tika URL: ${url}`);
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
                    console.warn(`Tika extraction failed at ${url}: ${response.status} ${response.statusText}`);
                    continue; // Try next URL
                }

                const text = await response.text();
                const result = text.trim();

                // Ergebnis cachen (auch leere Strings, um wiederholte Versuche zu vermeiden)
                tikaCache.set(hash, result);

                const cacheStats = tikaCache.getStats();
                const semaphoreStats = tikaSemaphore.getStats();
                console.debug(`Tika extraction successful - Cache: ${cacheStats.hits}H/${cacheStats.misses}M (${cacheStats.hitRate}%) - Semaphore: ${semaphoreStats.inProgress} active, ${semaphoreStats.waitCount} waiting`);

                return result;
            } catch (error) {
                console.warn(`Tika extraction error at ${url}:`, error instanceof Error ? error.message : 'Unknown error');
                // Continue to next URL
            }
        }

        // Alle URLs fehlgeschlagen - auch das cachen wir (als leeren String)
        console.error('All Tika URLs failed');
        tikaCache.set(hash, '');
        return '';
    });
}

// Legacy PDF-Extraktion (mit verbessertem Memory Management)
function extractTextFromPdf(buffer: Buffer): Promise<string> {
    return new Promise((resolve) => {
        const pdfParser = new PDFParser(null, true);
        let completed = false;

        const finish = (text: string) => {
            if (completed) return;
            completed = true;

            // Explizites Cleanup
            try {
                pdfParser.removeAllListeners();
            } catch (e) {
                // Ignore cleanup errors
            }

            resolve(text);
        };

        pdfParser.on('pdfParser_dataError', (err: any) => {
            console.warn('PDF parsing error:', err?.parserError || 'Unknown error');
            finish('');
        });

        pdfParser.on('pdfParser_dataReady', () => {
            try {
                const text = pdfParser.getRawTextContent();
                finish(text || '');
            } catch (err) {
                console.warn('Error getting PDF text content:', err);
                finish('');
            }
        });

        try {
            pdfParser.parseBuffer(buffer);
        } catch (err) {
            console.error('Error parsing PDF buffer:', err);
            finish('');
        }

        // Timeout reduziert für bessere Performance
        setTimeout(() => {
            console.warn('PDF parsing timed out');
            finish('');
        }, 5000);
    });
}

// Legacy Text-Extraktion für verschiedene Formate
async function extractTextLegacy(buffer: Buffer, mimeType: string): Promise<string> {
    try {
        if (mimeType === 'application/pdf') {
            // PDF-Größe prüfen (Memory-Protection)
            if (buffer.length > 50 * 1024 * 1024) { // 50MB Limit
                console.warn('PDF too large for legacy extraction, skipping');
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
        console.error(`Error extracting text from attachment with MIME type ${mimeType}:`, error);

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }

        return '';
    }
}

// Haupt-Extraktionsfunktion
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
    // Eingabe-Validierung
    if (!buffer || buffer.length === 0) {
        return '';
    }

    if (!mimeType) {
        console.warn('No MIME type provided for text extraction');
        return '';
    }

    // Allgemeines Größenlimit
    const maxSize = process.env.TIKA_URL ? 100 * 1024 * 1024 : 50 * 1024 * 1024; // 100MB für Tika, 50MB für Legacy
    if (buffer.length > maxSize) {
        console.warn(`File too large for text extraction: ${buffer.length} bytes (limit: ${maxSize})`);
        return '';
    }

    // Tika vs Legacy entscheiden
    const tikaUrl = process.env.TIKA_URL;

    if (tikaUrl) {
        // Tika entscheidet selbst was es parsen kann (inkl. OCR für Bilder!)
        console.debug(`Using Tika for text extraction: ${mimeType}`);
        return await extractTextWithTika(buffer, mimeType);
    } else {
        // Nur bei Legacy-Modus MIME-Type-Filterung
        const unsupportedTypes = ['image/', 'video/', 'audio/'];
        if (unsupportedTypes.some(type => mimeType.startsWith(type))) {
            console.warn(`Unsupported MIME type for legacy extraction: ${mimeType}`);
            return '';
        }
        console.debug(`Using legacy extraction for: ${mimeType}`);
        const result = await extractTextLegacy(buffer, mimeType);

        if (!result && mimeType !== 'application/pdf') {
            console.warn(`Unsupported MIME type for text extraction: ${mimeType}`);
        }

        return result;
    }
}

// Helper-Funktion um zu prüfen ob Tika verfügbar ist
export async function checkTikaAvailability(): Promise<boolean> {
    const tikaUrl = process.env.TIKA_URL;
    if (!tikaUrl) {
        return false;
    }

    try {
        const response = await fetch(`${tikaUrl}/version`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000) // 5 Sekunden Timeout
        });

        if (response.ok) {
            const version = await response.text();
            console.info(`Tika server available, version: ${version.trim()}`);
            return true;
        }

        return false;
    } catch (error) {
        console.warn('Tika server not available:', error instanceof Error ? error.message : 'Unknown error');
        return false;
    }
}

// Optional: Tika-Health-Check beim Start
export async function initializeTextExtractor(): Promise<void> {
    const tikaUrl = process.env.TIKA_URL;

    if (tikaUrl) {
        const isAvailable = await checkTikaAvailability();
        if (!isAvailable) {
            console.error(`Tika server configured but not available at: ${tikaUrl}`);
            console.error('Text extraction will fall back to legacy methods or fail');
        }
    } else {
        console.info('Using legacy text extraction methods (pdf2json, mammoth, xlsx)');
        console.info('Set TIKA_URL environment variable to use Apache Tika for better extraction');
    }
}

// Cache-Statistiken abrufen
export function getTikaCacheStats(): { size: number; maxSize: number; hits: number; misses: number; hitRate: number } {
    return tikaCache.getStats();
}

// Semaphor-Statistiken abrufen
export function getTikaSemaphoreStats(): { inProgress: number; waitCount: number } {
    return tikaSemaphore.getStats();
}

// Cache leeren (z.B. für Tests oder manuelles Reset)
export function clearTikaCache(): void {
    tikaCache.reset();
    tikaSemaphore.clear();
    console.info('Tika cache and semaphore cleared');
}
