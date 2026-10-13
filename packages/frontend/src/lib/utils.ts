import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2) {
	if (bytes === 0) return '0 Bytes';

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * The value to end a chart axis at: the next round number above the data, with headroom.
 *
 * Charts used to end their axis at `max * 1.1`, which is round only by accident. The
 * roundness is what decides how many labels appear, because d3 does not honour a requested
 * tick count so much as pick the nearest tidy step and emit however many that takes. Asked
 * for six ticks on a domain of 165,000 (150,000 emails plus a tenth) it settles on steps of
 * 20,000 and returns nine — which at the height of a dashboard card is a label every 28
 * pixels, the crowding reported in #433. Ending at 200,000 instead, the same request yields
 * five labels, and stays five as the card grows or shrinks.
 *
 * Rounding up also buys the headroom that keeps a point's data label clear of the top
 * gridline, which is the second half of that report.
 *
 * 2.5 earns its place in the ladder: without it a domain of 231,000 would round to 500,000
 * and draw the data at under half height. A floor of 1 covers an axis with nothing on it
 * yet — `Math.max()` of an empty list is -Infinity, and a domain of [0, -Infinity] renders
 * nothing at all.
 */
export function niceAxisMax(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 1;
	}

	// Headroom first, then round up, so a value sitting exactly on a round number gains room
	// above it instead of touching the top of the plot.
	const target = value * 1.05;
	const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
	const normalized = target / magnitude;

	// The steps d3 itself subdivides cleanly.
	const steps = [1, 2, 2.5, 5, 10];
	const step = steps.find((candidate) => normalized <= candidate) ?? 10;

	return step * magnitude;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
