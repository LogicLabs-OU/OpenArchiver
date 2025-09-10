import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import { ocrService } from '../services/OcrService';
import { logger } from '../config/logger';
import { config } from '../config';
import { pdfToPng } from 'pdf-to-png-converter';

interface PdfExtractResult {
	text: string;
	hasText: boolean;
}

function extractTextFromPdf(buffer: Buffer): Promise<PdfExtractResult> {
	return new Promise((resolve) => {
		const pdfParser = new PDFParser(null, true);
		let completed = false;

		const finish = (result: PdfExtractResult) => {
			if (completed) return;
			completed = true;
			pdfParser.removeAllListeners();
			resolve(result);
		};

		pdfParser.on('pdfParser_dataError', (err) => {
			logger.error({ err }, 'Error parsing PDF for text extraction');
			finish({ text: '', hasText: false });
		});

		pdfParser.on('pdfParser_dataReady', (pdfData) => {
			let hasText = false;
			if (pdfData?.Pages) {
				for (const page of pdfData.Pages) {
					if (page.Texts && page.Texts.length > 0) {
						hasText = true;
						break;
					}
				}
			}
			const text = pdfParser.getRawTextContent();
			finish({ text, hasText });
		});

		try {
			pdfParser.parseBuffer(buffer);
		} catch (err) {
			logger.error({ err }, 'Error parsing PDF buffer');
			finish({ text: '', hasText: false });
		}

		setTimeout(() => finish({ text: '', hasText: false }), 10000);
	});
}

const OCR_SUPPORTED_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/tiff',
	'image/bmp',
	'image/webp',
	'image/x-portable-bitmap',
];

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
	try {
		if (mimeType === 'application/pdf') {
			const pdfResult = await extractTextFromPdf(buffer);
			if (!pdfResult.hasText && config.app.ocrEnabled) {
				logger.info(
					{ mimeType },
					'PDF contains no selectable text. Attempting OCR fallback...'
				);
				const pngPages = await pdfToPng(buffer);
				let ocrText = '';
				for (const pngPage of pngPages) {
					ocrText += await ocrService.recognize(pngPage.content) + '\n';
				}
				return ocrText;
			}
			return pdfResult.text;
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
