import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import { logger } from '../config/logger';
import { OcrService } from '../services/OcrService';

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
			if (buffer.length > 50 * 1024 * 1024) {
				// 50MB Limit
				logger.warn('PDF too large for legacy extraction, skipping');
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
