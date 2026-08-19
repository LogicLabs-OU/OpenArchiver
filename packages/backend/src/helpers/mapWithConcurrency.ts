/**
 * Runs `fn` over `items` with at most `limit` calls in flight, settling every one.
 *
 * The obvious alternative — slicing the input into waves of `limit` and awaiting
 * `Promise.allSettled` on each — is a barrier: every wave runs at the speed of its slowest member,
 * and the rest of the wave's slots sit idle until it finishes. That costs real time here, because
 * the work this bounds is document building, where one hostile PDF can hold a slot for the full
 * `PDF_PARSE_TIMEOUT_MS` while nine other emails wait on nothing.
 *
 * A shared cursor with `limit` runners keeps every slot busy: a runner that finishes early takes the
 * next item immediately rather than waiting for its wave-mates.
 *
 * Results are returned in input order, and settled rather than thrown, so callers can attribute a
 * failure back to the item that caused it.
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(items.length);
	if (items.length === 0) {
		return results;
	}

	let cursor = 0;
	const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		// Read-and-advance is atomic here only because there is no await between the two lines —
		// JavaScript's single thread cannot interleave them, so each runner claims a distinct index.
		while (cursor < items.length) {
			const index = cursor++;
			try {
				results[index] = { status: 'fulfilled', value: await fn(items[index], index) };
			} catch (reason) {
				results[index] = { status: 'rejected', reason };
			}
		}
	});

	await Promise.all(runners);
	return results;
}
