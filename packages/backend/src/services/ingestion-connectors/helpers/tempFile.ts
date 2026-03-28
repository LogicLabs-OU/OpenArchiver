import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';

/**
 * Writes a raw email buffer to a temporary file on disk and returns the path.
 * This keeps large buffers off the JS heap between connector yield and processEmail().
 * The caller (IngestionService.processEmail) is responsible for deleting the file.
 */
export async function writeEmailToTempFile(buffer: Buffer): Promise<string> {
	const tempFilePath = join(tmpdir(), `oa-email-${randomUUID()}.eml`);
	await writeFile(tempFilePath, buffer);
	return tempFilePath;
}
