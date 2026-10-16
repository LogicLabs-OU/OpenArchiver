import { derived, writable, type Readable } from 'svelte/store';
import type { DateFormat } from '@open-archiver/types';

export type { DateFormat };

/** Anything the dashboard passes to a date formatter. */
export type DateInput = Date | string | number | null | undefined;

/** A formatter bound to the system's current setting. */
export type DateFormatter = (value: DateInput) => string;

/**
 * The organisation-wide date format and the app language it follows by default.
 *
 * Both come from system settings, chosen by an administrator and stored in the database, and
 * are set once per page load by the root layout. The value is the same for every user, so it is
 * safe for this store to be shared across requests during server rendering.
 */
export const dateSettings = writable<{ format: DateFormat; language: string }>({
	format: 'language',
	language: 'en',
});

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(value: DateInput): Date | null {
	if (value === null || value === undefined || value === '') return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** The local UTC offset as ISO 8601 writes it, e.g. `+02:00`. */
function isoOffset(d: Date): string {
	const minutes = -d.getTimezoneOffset();
	const sign = minutes >= 0 ? '+' : '-';
	const abs = Math.abs(minutes);
	return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function formatDate(
	value: DateInput,
	format: DateFormat = 'language',
	language = 'en'
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
		case 'language':
		default:
			return d.toLocaleDateString(language);
	}
}

export function formatDateTime(
	value: DateInput,
	format: DateFormat = 'language',
	language = 'en'
): string {
	const d = toDate(value);
	if (!d) return '';
	if (format === 'language') return d.toLocaleString(language);
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	// ISO 8601 joins date and time with `T` and must carry the offset; without it a local time
	// is ambiguous, and the same audit entry would read differently to reviewers in two zones.
	if (format === 'iso') return `${formatDate(d, format)}T${time}${isoOffset(d)}`;
	return `${formatDate(d, format)} ${time}`;
}

export const formatDateStore: Readable<DateFormatter> = derived(
	dateSettings,
	($s) => (value: DateInput) => formatDate(value, $s.format, $s.language)
);

export const formatDateTimeStore: Readable<DateFormatter> = derived(
	dateSettings,
	($s) => (value: DateInput) => formatDateTime(value, $s.format, $s.language)
);
