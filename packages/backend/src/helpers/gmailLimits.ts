/** Skip RAW download/parse above this decoded size. Larger buffers trigger V8 `invalid array length`. */
export const MAX_GMAIL_RAW_BYTES = 32 * 1024 * 1024;

export function gmailSizeEstimateExceedsLimit(
	sizeEstimate: number | null | undefined,
	maxBytes: number = MAX_GMAIL_RAW_BYTES
): boolean {
	return typeof sizeEstimate === 'number' && sizeEstimate > maxBytes;
}

/**
 * Gmail `messages.get(format=RAW)` returns base64url. Decoded size is ~length * 3/4.
 * Check before `Buffer.from` so a single oversized message cannot OOM the worker.
 */
export function rawBase64ExceedsLimit(
	rawBase64: string,
	maxBytes: number = MAX_GMAIL_RAW_BYTES
): boolean {
	return (rawBase64.length * 3) / 4 > maxBytes;
}
