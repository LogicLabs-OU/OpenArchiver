import { parentPort } from 'worker_threads';
import { simpleParser } from 'mailparser';

/**
 * Worker thread entry for parseEmailForIndexing. Kept to mailparser alone, with no config, logger,
 * database or Redis import, so a thread that is terminated mid-parse leaves nothing open behind it.
 */

export interface EmailParseRequest {
	id: number;
	eml: Uint8Array;
	/** Send attachment bytes back. Only the preserve-original path reads them from the .eml. */
	withAttachments: boolean;
}

export interface ParsedEmailAttachment {
	filename?: string;
	contentType: string;
	content: Uint8Array;
}

export interface ParsedEmailForIndexing {
	text?: string;
	html?: string;
	attachments: ParsedEmailAttachment[];
}

export type EmailParseResponse =
	| { id: number; result: ParsedEmailForIndexing }
	| { id: number; error: string };

parentPort?.on('message', async ({ id, eml, withAttachments }: EmailParseRequest) => {
	let response: EmailParseResponse;
	try {
		// textAsHtml is never read by the indexer, and building it runs a regex that is quadratic on
		// a long run of spaces inside a line: 160k spaces took 28 s (#526).
		const parsed = await simpleParser(Buffer.from(eml.buffer, eml.byteOffset, eml.byteLength), {
			skipTextToHtml: true,
			skipTextLinks: true,
		});
		response = {
			id,
			result: {
				text: parsed.text,
				html: parsed.html || undefined,
				attachments: withAttachments
					? parsed.attachments.map((attachment) => ({
							filename: attachment.filename,
							contentType: attachment.contentType,
							content: attachment.content,
						}))
					: [],
			},
		};
	} catch (error) {
		response = { id, error: error instanceof Error ? error.message : String(error) };
	}
	parentPort?.postMessage(response);
});
