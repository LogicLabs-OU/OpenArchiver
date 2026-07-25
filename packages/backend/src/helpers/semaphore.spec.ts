import { describe, it, expect } from 'vitest';
import { Semaphore } from './semaphore';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('Semaphore', () => {
	it('never lets more than `permits` holders run concurrently', async () => {
		const CONCURRENCY = 3;
		const sem = new Semaphore(CONCURRENCY);
		let active = 0;
		let peak = 0;

		const tasks = Array.from({ length: 20 }, () =>
			(async () => {
				await sem.acquire();
				try {
					active++;
					peak = Math.max(peak, active);
					await tick(5);
				} finally {
					active--;
					sem.release();
				}
			})()
		);

		await Promise.all(tasks);
		expect(peak).toBe(CONCURRENCY);
		expect(active).toBe(0);
	});

	it('blocks acquire when saturated and resumes on release', async () => {
		const sem = new Semaphore(1);
		await sem.acquire(); // take the only permit

		let acquired = false;
		const pending = sem.acquire().then(() => {
			acquired = true;
		});

		await tick(5);
		expect(acquired).toBe(false); // still blocked

		sem.release();
		await pending;
		expect(acquired).toBe(true);
	});

	it('hands permits to waiters in FIFO order', async () => {
		const sem = new Semaphore(1);
		await sem.acquire();

		const order: number[] = [];
		const w1 = sem.acquire().then(() => order.push(1));
		const w2 = sem.acquire().then(() => order.push(2));
		const w3 = sem.acquire().then(() => order.push(3));

		sem.release();
		await w1;
		sem.release();
		await w2;
		sem.release();
		await w3;

		expect(order).toEqual([1, 2, 3]);
	});

	it('clamps invalid permit counts to at least 1', async () => {
		const sem = new Semaphore(0);
		await sem.acquire(); // would deadlock if permits were 0
		expect(true).toBe(true);
	});

	it('draining by acquiring all permits waits for in-flight work', async () => {
		const CONCURRENCY = 4;
		const sem = new Semaphore(CONCURRENCY);
		let done = 0;

		for (let i = 0; i < 10; i++) {
			await sem.acquire();
			void (async () => {
				try {
					await tick(3);
					done++;
				} finally {
					sem.release();
				}
			})();
		}
		// Drain: only possible once all in-flight tasks released their permit.
		for (let i = 0; i < CONCURRENCY; i++) await sem.acquire();

		expect(done).toBe(10);
	});
});
