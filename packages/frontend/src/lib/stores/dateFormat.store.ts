import { persisted } from 'svelte-persisted-store';
import { derived, type Readable } from 'svelte/store';

export type DateFormat = 'locale' | 'iso' | 'eu' | 'us';

/** Anything the dashboard passes to a date formatter. */
export type DateInput = Date | string | number | null | undefined;

/** A formatter bound to the user's current preference. */
export type DateFormatter = (value: DateInput) => string;

export const dateFormat = persisted<DateFormat>('dateFormat', 'locale');

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(value: DateInput): Date | null {
	if (value === null || value === undefined || value === '') return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: DateInput, format: DateFormat = 'locale'): string {
	const d = toDate(value);
	if (!d) return '';
	const y = d.getFullYear();
	const m = pad(d.getMonth() + 1);
	const day = pad(d.getDate());
	switch (format) {
		case 'iso':
			return `${y}-${m}-${day}`;
		case 'eu':
			return `${day}/${m}/${y}`;
		case 'us':
			return `${m}/${day}/${y}`;
		case 'locale':
		default:
			return d.toLocaleDateString();
	}
}

export function formatDateTime(value: DateInput, format: DateFormat = 'locale'): string {
	const d = toDate(value);
	if (!d) return '';
	if (format === 'locale') return d.toLocaleString();
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	return `${formatDate(d, format)} ${time}`;
}

export const formatDateStore: Readable<DateFormatter> = derived(
	dateFormat,
	($f) => (value: DateInput) => formatDate(value, $f)
);

export const formatDateTimeStore: Readable<DateFormatter> = derived(
	dateFormat,
	($f) => (value: DateInput) => formatDateTime(value, $f)
);
