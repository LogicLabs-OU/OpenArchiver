import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import { ocrService } from '../services/OcrService';
import { logger } from '../config/logger';
import { config } from '../config';

function extractTextFromPdf(buffer: Buffer): Promise<string> {
	return new Promise((resolve) => {
		const pdfParser = new PDFParser(null, true);
		let completed = false;

		const finish = (text: string) => {
			if (completed) return;
			completed = true;
			pdfParser.removeAllListeners();
			resolve(text);
		};

		pdfParser.on('pdfParser_dataError', (err) => {
			logger.error({ err }, 'Error parsing PDF for text extraction');
			finish('');
		});
		pdfParser.on('pdfParser_dataReady', () => finish(pdfParser.getRawTextContent()));

		try {
			pdfParser.parseBuffer(buffer);
		} catch (err) {
			logger.error({ err }, 'Error parsing PDF buffer');
			finish('');
		}

		setTimeout(() => finish(''), 10000);
	});
}

const OCR_SUPPORTED_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/tiff',
	'image/bmp',
	'image/gif',
];

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
	try {
		if (mimeType === 'application/pdf') {
			let text = await extractTextFromPdf(buffer);
			if ((!text || text.trim() === '') && config.app.ocrEnabled) {
				logger.info(
					{ mimeType },
					'PDF text extraction returned empty. Attempting OCR fallback...'
				);
				text = await ocrService.recognize(buffer);
			}
			return text;
		}

		if (OCR_SUPPORTED_MIME_TYPES.includes(mimeType) && config.app.ocrEnabled) {
			return await ocrService.recognize(buffer);
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
			return fullText;
		}

		if (
			mimeType.startsWith('text/') ||
			mimeType === 'application/json' ||
			mimeType === 'application/xml'
		) {
			return buffer.toString('utf-8');
		}
	} catch (error) {
		logger.error({ err: error, mimeType }, 'Error extracting text from attachment');
		return '';
	}

	logger.warn({ mimeType }, 'Unsupported MIME type for text extraction');
	return '';
}
