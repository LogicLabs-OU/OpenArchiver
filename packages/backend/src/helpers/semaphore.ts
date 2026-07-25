/**
 * Minimal counting semaphore for bounding concurrency without a runtime
 * dependency. `acquire()` resolves as soon as a permit is free; `release()`
 * hands a permit straight to the next waiter (FIFO) or returns it to the pool.
 *
 * Usage: acquire before starting a task, release in its `finally`. To wait for
 * all in-flight tasks to drain, acquire every permit — only possible once none
 * are held.
 */
export class Semaphore {
	private permits: number;
	private readonly waiters: Array<() => void> = [];

	constructor(permits: number) {
		this.permits = Math.max(1, Math.floor(permits));
	}

	async acquire(): Promise<void> {
		if (this.permits > 0) {
			this.permits--;
			return;
		}
		await new Promise<void>((resolve) => this.waiters.push(resolve));
	}

	release(): void {
		const next = this.waiters.shift();
		if (next) {
			// Hand the permit directly to the next waiter without touching the
			// counter, so no other acquire() can slip in ahead of them.
			next();
		} else {
			this.permits++;
		}
	}
}
