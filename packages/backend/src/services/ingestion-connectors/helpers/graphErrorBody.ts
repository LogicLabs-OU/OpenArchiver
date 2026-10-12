/** Enough for any Graph error document; a body past this is not one. */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/**
 * Fills in the Graph error code on a failure that came back from a stream request.
 *
 * The Graph client hands a `STREAM` response over unread: `GraphResponseHandler` returns the body as
 * it is, and when the status is not ok that unread body is what gets thrown. The error handler then
 * finds no `.error` field on a stream, so the `GraphError` it builds has `code: null`, an empty
 * message and the stream itself as `body`. Every decision downstream — retry or not, count or
 * skip — is left with nothing but the status to read. Reading the body here, only once a request
 * has already failed, gives those decisions the code Graph sent.
 *
 * Nothing is thrown: a body that cannot be read or is not a Graph error document leaves the error
 * exactly as it arrived.
 */
export async function attachGraphErrorBody(error: unknown): Promise<void> {
	const candidate = error as {
		statusCode?: unknown;
		code?: unknown;
		message?: unknown;
		body?: unknown;
	} | null;
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		typeof candidate.statusCode !== 'number' ||
		candidate.code !== null ||
		!isUnreadStream(candidate.body)
	) {
		return;
	}

	try {
		const text = await readStreamText(candidate.body, MAX_ERROR_BODY_BYTES);
		const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
		if (!parsed || typeof parsed !== 'object' || !parsed.error) {
			return;
		}
		if (typeof parsed.error.code === 'string') {
			candidate.code = parsed.error.code;
		}
		if (typeof parsed.error.message === 'string') {
			candidate.message = parsed.error.message;
		}
		candidate.body = text;
	} catch {
		// Not a Graph error document, or the connection went before the body did. The status is
		// still on the error, and that is what the caller had before.
	}
}

/** A web `ReadableStream` (what Node's fetch yields) or anything else async-iterable. */
const isUnreadStream = (value: unknown): value is AsyncIterable<Uint8Array> =>
	!!value &&
	typeof value === 'object' &&
	(typeof (value as any)[Symbol.asyncIterator] === 'function' ||
		typeof (value as any).getReader === 'function');

async function readStreamText(stream: AsyncIterable<Uint8Array>, limit: number): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of stream) {
		const buffer = Buffer.from(chunk);
		size += buffer.length;
		if (size > limit) {
			throw new Error('Error body exceeds the size of a Graph error document');
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString('utf8');
}
