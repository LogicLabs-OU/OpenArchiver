import v8 from 'node:v8';
import vm from 'node:vm';
import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import { logger } from '../config/logger';
import { OcrService } from '../services/OcrService';

/**
 * Runs pdf2json parses one at a time per process.
 *
 * Nothing above this file bounds how many PDFs parse at once: the indexing worker runs several jobs
 * concurrently, each job builds documents concurrently, and each document extracts its attachments
 * concurrently — those multiply. A pdf2json parse is the one step here that can hold a gigabyte on
 * its own, and run in parallel such parses defeat any per-parse memory guard: each one looks safely
 * under the ceiling until their sum aborts the process.
 *
 * Serializing costs little. The parse is CPU-bound in long synchronous stretches on one shared
 * event loop, so parallel parses never gave real throughput — only a higher peak.
 */
let pdfParseChain: Promise<unknown> = Promise.resolve();

/**
 * A major garbage collection, on demand.
 *
 * Node only exposes `global.gc` under --expose-gc, which production does not run with, so the flag
 * is enabled just long enough to capture the function and then switched back off. Resolved once at
 * module load; `null` when the runtime refuses, and every caller treats that as "skip".
 */
const requestGc: (() => void) | null = (() => {
	const existing = (globalThis as { gc?: () => void }).gc;
	if (typeof existing === 'function') {
		return existing;
	}
	try {
		v8.setFlagsFromString('--expose_gc');
		const captured = vm.runInNewContext('gc') as (() => void) | undefined;
		v8.setFlagsFromString('--no-expose_gc');
		return typeof captured === 'function' ? captured : null;
	} catch {
		return null;
	}
})();

/**
 * Runs one parse, then reclaims what it left behind before the next may start.
 *
 * The reclaim is not tidiness, it is correctness. An abandoned parse's memory becomes garbage the
 * instant destroy() runs, but V8 collects it whenever it likes, so back-to-back parses each begin
 * on a heap still holding their predecessors' remains. Measured over twenty parses without this
 * step, the heap climbed to 2003MB of 2048MB and the guard started abandoning healthy PDFs whose
 * own growth was fine — silently dropping text that should have been indexed. Collecting here
 * makes each parse's baseline mean what the guard assumes it means.
 *
 * Costs a few hundred milliseconds of a job that already takes seconds, and only on this path.
 */
const serializePdfParse = <T>(run: () => Promise<T>): Promise<T> => {
	const reclaimThenRun = async (): Promise<T> => {
		try {
			return await run();
		} finally {
			try {
				requestGc?.();
			} catch {
				// A refused collection is survivable; the growth budget still bounds each parse.
			}
		}
	};
	// Chained on settle rather than success, so one rejected parse cannot wedge the queue.
	const result = pdfParseChain.then(reclaimThenRun, reclaimThenRun);
	pdfParseChain = result.catch(() => undefined);
	return result;
};

/**
 * How much a single PDF parse may GROW the heap before it is abandoned, as a share of this
 * process's own heap limit — read from V8 rather than assumed, because only the indexing worker is
 * started with an explicit --max-old-space-size; other processes calling this helper have
 * different limits.
 *
 * A growth budget rather than an absolute ceiling, deliberately. destroy() below releases the
 * abandoned parse's memory only at the next GC, so the next parse in the chain starts while
 * heapUsed still carries its predecessor's garbage: measured here, an absolute ceiling abandoned a
 * perfectly healthy PDF at "1429MB" that was almost entirely leftovers. What a parse ADDS over its
 * own baseline is the quantity that actually belongs to it.
 *
 * 0.25 rather than something roomier because the budget is paid at most twice over: the previous
 * parse's not-yet-collected garbage can be up to one budget, and this parse's own growth another,
 * so the pair stays near half the heap with the rest of the batch (built documents, raw .eml
 * buffers) still resident. It is also ample — the largest healthy PDF in the affected mailbox
 * grows 261MB, against a 512MB budget on the indexing worker's 2GB heap. A wider budget was tried
 * first and reproduced the very crash this guards against.
 */
const pdfHeapBudgetBytes = (): number => {
	const configured = Number(process.env.PDF_PARSE_HEAP_BUDGET_RATIO);
	const ratio = configured > 0 && configured < 1 ? configured : 0.25;
	return Math.floor(v8.getHeapStatistics().heap_size_limit * ratio);
};

/**
 * Absolute backstop, as a share of the heap limit.
 *
 * The growth budget assumes the heap this parse started on was mostly reclaimable. When it is not
 * — an unusually large batch resident alongside — a parse can stay inside its budget while the
 * process is already out of room. This catches that, whoever is at fault: past this point the next
 * allocation is likelier to abort the process than to succeed, and an attachment's text is not
 * worth the worker.
 */
const HEAP_HARD_STOP_RATIO = 0.85;

/** How often the heap is sampled while a PDF parse is in flight. */
const HEAP_POLL_INTERVAL_MS = 250;

// Legacy PDF extraction (with improved memory management)
function extractTextFromPdf(buffer: Buffer): Promise<string> {
	return serializePdfParse(
		() =>
			new Promise((resolve) => {
				const pdfParser = new PDFParser(null, true);
				let completed = false;

				// Safety timeout: pdf2json can hang on malformed/complex PDFs and never emit
				// either dataError or dataReady, leaving this promise unresolved forever. That
				// wedges the whole indexing batch until BullMQ kills the job as "stalled" and
				// the worker dies. Resolving with '' on timeout keeps the email indexable
				// (without this attachment's text) and the worker alive. Configurable so large
				// but valid PDFs on slow hosts aren't truncated prematurely.
				const timeoutMs = Number(process.env.PDF_PARSE_TIMEOUT_MS) || 20000;
				let timer: NodeJS.Timeout | null = null;
				let heapWatchdog: NodeJS.Timeout | null = null;

				const finish = (text: string) => {
					if (completed) return;
					completed = true;

					if (timer) {
						clearTimeout(timer);
						timer = null;
					}
					if (heapWatchdog) {
						clearInterval(heapWatchdog);
						heapWatchdog = null;
					}

					// explicit cleanup
					try {
						pdfParser.removeAllListeners();
					} catch (e) {
						// Ignore cleanup errors
					}

					// The one call that actually stops the work. Detaching the listeners above only
					// stops this code hearing from the parser — it keeps reading and keeps
					// allocating for as long as the document takes. A 5.6MB scanned book measured
					// on a live deployment blew past a 2GB heap ~25s in and aborted the process
					// with "Ineffective mark-compacts near heap limit", five seconds after the
					// timeout had already resolved this promise and moved on. destroy() releases
					// the parser's accumulated page data: the same file, destroyed at the timeout,
					// dropped the process from 1.6GB back to 10MB and it survived.
					try {
						// Present at runtime in pdf2json 3.1.6 but missing from its typings.
						(pdfParser as unknown as { destroy?: () => void }).destroy?.();
					} catch (e) {
						// Tolerated: the timeout and heap guard still bound the damage.
					}

					resolve(text);
				};

				timer = setTimeout(() => {
					logger.warn(
						`PDF parsing timed out after ${timeoutMs}ms - skipping attachment text`
					);
					finish('');
				}, timeoutMs);

				// A time limit alone cannot bound memory, because the two are not proportional: a
				// well-formed 6MB PDF finishes in about a second, while a pathological one of the
				// same size is still allocating hundreds of MB/s at twenty. Watching the heap
				// catches what the clock misses — and catches it before the process dies, not
				// after. Growth is measured against this parse's own starting point; see
				// pdfHeapBudgetBytes for why the baseline matters.
				const budget = pdfHeapBudgetBytes();
				const hardStop = Math.floor(
					v8.getHeapStatistics().heap_size_limit * HEAP_HARD_STOP_RATIO
				);
				const heapBaseline = process.memoryUsage().heapUsed;
				heapWatchdog = setInterval(() => {
					const heapUsed = process.memoryUsage().heapUsed;
					const grown = heapUsed - heapBaseline;
					if (grown > budget || heapUsed > hardStop) {
						logger.warn(
							{
								heapUsedMb: Math.round(heapUsed / 1024 / 1024),
								grownMb: Math.round(grown / 1024 / 1024),
								budgetMb: Math.round(budget / 1024 / 1024),
								pdfBytes: buffer.length,
							},
							'PDF parsing abandoned at heap budget - skipping attachment text'
						);
						finish('');
					}
				}, HEAP_POLL_INTERVAL_MS);

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
					// Verbosity ERRORS (0). Passing nothing does not mean "leave it alone" — parseBuffer
					// hands the argument to nodeUtil.verbosity(), which treats a non-number as "reset to
					// WARNINGS", so every call re-enabled the noise. And that noise goes straight to
					// console.log inside pdf2json: outside pino, unaffected by LOG_LEVEL, and emitted once
					// per annotation per PDF ("Unsupported: field.type of Link", "NOT valid form element"),
					// which buries the worker's own logs on any mailbox carrying PDFs.
					// Real failures are unaffected — pdf2json's error() ignores verbosity and throws, and
					// the dataError handler above reports those through pino.
					pdfParser.parseBuffer(buffer, 0);
				} catch (err) {
					logger.error('Error parsing PDF buffer:', err);
					finish('');
				}
			})
	);
}

/**
 * Largest image, in pixels, a PDF may contain for pdf2json to parse it.
 *
 * pdf2json grows its decode buffer with `size <<= 1`, which wraps to 0 once a stream decodes to more
 * than 1GiB, and then loops forever (#497). The loop is synchronous, so neither the parse timeout
 * nor the heap guard above can run, and the indexing worker sits at 100% CPU until killed. 2^28
 * pixels at 4 bytes each (CMYK, the most an 8-bit colour space takes) is exactly 1GiB.
 */
const MAX_PDF_IMAGE_PIXELS = 2 ** 28;

/**
 * Pixel count of the largest image XObject in a PDF, read straight from the raw bytes.
 *
 * Image dictionaries are always readable without parsing: an image is a stream, and a stream cannot
 * be stored inside a compressed object stream. Only direct integers are read; a `/Width 12 0 R`
 * reference is not resolved, and an inline image inside a compressed content stream is not seen.
 */
function largestPdfImagePixels(buffer: Buffer): number {
	let largest = 0;
	for (let at = buffer.indexOf('/Image'); at !== -1; at = buffer.indexOf('/Image', at + 6)) {
		// The image's dictionary: from the start of its object to the start of its stream.
		const start = Math.max(0, buffer.lastIndexOf('obj', at));
		const end = buffer.indexOf('stream', at);
		if (end === -1 || end - start > 4096) {
			continue;
		}
		const dict = buffer.toString('latin1', start, end);
		if (!/\/Subtype\s*\/Image\b/.test(dict)) {
			continue;
		}
		const width = Number(dict.match(/\/Width\s+(\d+)(?!\s+\d+\s+R)/)?.[1] ?? 0);
		const height = Number(dict.match(/\/Height\s+(\d+)(?!\s+\d+\s+R)/)?.[1] ?? 0);
		largest = Math.max(largest, width * height);
	}
	return largest;
}

// Legacy text extraction for various formats
async function extractTextLegacy(buffer: Buffer, mimeType: string): Promise<string> {
	try {
		if (mimeType === 'application/pdf') {
			// Check PDF size (memory protection)
			if (buffer.length > 50 * 1024 * 1024) {
				// 50MB Limit
				logger.warn('PDF too large for legacy extraction, skipping');
				return '';
			}
			const pixels = largestPdfImagePixels(buffer);
			if (pixels > MAX_PDF_IMAGE_PIXELS) {
				logger.warn(
					{ pixels, pdfBytes: buffer.length },
					'PDF contains an image too large for the built-in parser, skipping'
				);
				return '';
			}
			return await extractTextFromPdf(buffer);
		}

		if (
			mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		) {
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
		logger.warn(
			`File too large for text extraction: ${buffer.length} bytes (limit: ${maxSize})`
		);
		return '';
	}

	// Decide between Tika and legacy
	const tikaUrl = process.env.TIKA_URL;

	if (tikaUrl) {
		// Tika decides what it can parse
		logger.debug(`Using Tika for text extraction: ${mimeType}`);
		const ocrService = new OcrService();
		try {
			return await ocrService.extractTextWithTika(buffer, mimeType);
		} catch (error) {
			logger.error({ error }, 'OCR text extraction failed, returning empty string');
			return '';
		}
	} else {
		// extract using legacy mode
		return await extractTextLegacy(buffer, mimeType);
	}
}
