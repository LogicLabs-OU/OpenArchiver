/**
 * Integration test: attachment text extraction through a real Apache Tika server.
 *
 * Runs against the compiled backend (`pnpm build` first) and needs TIKA_URL pointing at a running
 * Tika server, e.g.:
 *
 *   docker run -d --rm -p 9998:9998 apache/tika:4.1.0-full
 *   TIKA_URL=http://localhost:9998 pnpm --filter @open-archiver/backend test:integration:tika
 *
 * Skipped when TIKA_URL is not set.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { extractText } from '../dist/helpers/textExtractor.js';

const TIKA_URL = process.env.TIKA_URL;

/** Builds a minimal, valid single-page PDF that draws `text` with Helvetica. */
function buildPdf(text: string): Buffer {
	const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];

	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(pdf.length);
		pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xrefOffset = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return Buffer.from(pdf, 'latin1');
}

/** Builds an XLSX workbook with a single sheet containing `rows`. */
function buildXlsx(rows: string[][]): Buffer {
	const workbook = xlsx.utils.book_new();
	xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(rows), 'Sheet1');
	return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('text extraction via Apache Tika', { skip: !TIKA_URL && 'TIKA_URL not set' }, () => {
	before(async () => {
		const response = await fetch(`${TIKA_URL}/version`);
		assert.ok(response.ok, `Tika not reachable at ${TIKA_URL}: ${response.status}`);
		console.log(`Testing against ${(await response.text()).trim()}`);
	});

	test('extracts text from a PDF', async () => {
		const text = await extractText(buildPdf('Quarterly invoice 4711'), 'application/pdf');
		assert.match(text, /Quarterly invoice 4711/);
	});

	test('extracts cell values from an XLSX workbook', async () => {
		const buffer = buildXlsx([
			['Customer', 'Amount'],
			['Contoso Ltd', '1234'],
		]);
		const text = await extractText(
			buffer,
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
		assert.match(text, /Contoso Ltd/);
		assert.match(text, /1234/);
	});

	test('returns plain text, not Markdown, for structured documents', async () => {
		// Tika 4.x returns Markdown from bare /tika; the indexer must get plain text.
		const html =
			'<html><body><h1>Project Update</h1><ul><li>first item</li><li>second item</li></ul>' +
			'<p>a <b>bold</b> statement</p></body></html>';
		const text = await extractText(Buffer.from(html), 'text/html');

		assert.match(text, /Project Update/);
		assert.match(text, /first item/);
		assert.match(text, /a bold statement/);
		assert.doesNotMatch(text, /^#+\s/m, 'output contains Markdown headings');
		assert.doesNotMatch(text, /^\s*[-*]\s+first item/m, 'output contains Markdown bullets');
		assert.doesNotMatch(text, /\*\*bold\*\*/, 'output contains Markdown emphasis');
		assert.doesNotMatch(text, /<[a-z]+[^>]*>/i, 'output contains markup');
	});

	test('extracts plain text files', async () => {
		const text = await extractText(Buffer.from('just some plain text\n'), 'text/plain');
		assert.equal(text, 'just some plain text');
	});

	test('does not throw on a corrupt document', async () => {
		const text = await extractText(Buffer.from('%PDF-1.4 not really a pdf'), 'application/pdf');
		assert.equal(typeof text, 'string');
	});

	test('returns an empty string for an empty buffer without calling Tika', async () => {
		assert.equal(await extractText(Buffer.alloc(0), 'application/pdf'), '');
	});
});
