import { persisted } from 'svelte-persisted-store';
import { derived, type Readable } from 'svelte/store';

export type DateFormat = 'locale' | 'iso' | 'eu' | 'us';

export const dateFormat = persisted<DateFormat>('dateFormat', 'locale');

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(value: Date | string | number | null | undefined): Date | null {
	if (value === null || value === undefined || value === '') return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(
	value: Date | string | number | null | undefined,
	format: DateFormat = 'locale'
): string {
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

export function formatDateTime(
	value: Date | string | number | null | undefined,
	format: DateFormat = 'locale'
): string {
	const d = toDate(value);
	if (!d) return '';
	if (format === 'locale') return d.toLocaleString();
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	return `${formatDate(d, format)} ${time}`;
}

export const formatDateStore: Readable<
	(value: Date | string | number | null | undefined) => string
> = derived(dateFormat, ($f) => (value) => formatDate(value, $f));

export const formatDateTimeStore: Readable<
	(value: Date | string | number | null | undefined) => string
> = derived(dateFormat, ($f) => (value) => formatDateTime(value, $f));
