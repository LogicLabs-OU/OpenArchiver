<script lang="ts">
	/**
	 * Date-range filter with preset chips and a lazy-loaded RangeCalendar for the
	 * 'custom' tab. Per sub-plan §3.1 and §13 (lazy primitives).
	 *
	 * Preset semantics:
	 *   non-'custom' presets emit no concrete from/to — `url-state.ts` resolves
	 *   them at request time so e.g. "Last 30 days" tracks the wall clock.
	 *
	 *   'custom' emits a concrete { op:'between', value:[iso, iso] }.
	 */
	import type { TimestampFilter } from '@open-archiver/types';
	import type { DatePreset } from '../../url-state';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import FilterField from './FilterField.svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { t } from '$lib/translations';
	import {
		CalendarDate,
		getLocalTimeZone,
		parseAbsoluteToLocal,
		type DateValue,
	} from '@internationalized/date';
	import { endOfDay, startOfDay } from 'date-fns';

	type Props = {
		value: TimestampFilter | undefined;
		preset: DatePreset | undefined;
		onChange: (next: { value: TimestampFilter | undefined; preset: DatePreset | undefined }) => void;
	};

	let { value, preset, onChange }: Props = $props();

	const PRESETS: { id: DatePreset; key: string }[] = [
		{ id: 'today', key: 'app.search.filters.date_today' },
		{ id: 'yesterday', key: 'app.search.filters.date_yesterday' },
		{ id: 'last-7d', key: 'app.search.filters.date_last_7d' },
		{ id: 'last-30d', key: 'app.search.filters.date_last_30d' },
		{ id: 'this-month', key: 'app.search.filters.date_this_month' },
		{ id: 'last-month', key: 'app.search.filters.date_last_month' },
		{ id: 'this-year', key: 'app.search.filters.date_this_year' },
		{ id: 'last-year', key: 'app.search.filters.date_last_year' },
		{ id: 'custom', key: 'app.search.filters.date_custom' },
	];

	function isoToDateValue(iso: string | undefined): DateValue | undefined {
		if (!iso) return undefined;
		try {
			// Parse ISO and reduce to CalendarDate (date-only, no tz).
			const d = parseAbsoluteToLocal(iso);
			return new CalendarDate(d.year, d.month, d.day);
		} catch {
			return undefined;
		}
	}

	function dateValueToIsoStart(v: DateValue): string {
		const native = v.toDate(getLocalTimeZone());
		return startOfDay(native).toISOString();
	}

	function dateValueToIsoEnd(v: DateValue): string {
		const native = v.toDate(getLocalTimeZone());
		return endOfDay(native).toISOString();
	}

	function customRange(): { start?: DateValue; end?: DateValue } {
		if (!value) return {};
		if (value.op === 'between') {
			return {
				start: isoToDateValue(value.value[0]),
				end: isoToDateValue(value.value[1]),
			};
		}
		if (value.op === 'gte') return { start: isoToDateValue(value.value) };
		if (value.op === 'lte') return { end: isoToDateValue(value.value) };
		return { start: isoToDateValue(value.value) };
	}

	let popoverOpen = $state(false);

	function handlePreset(id: DatePreset) {
		if (id === 'custom') {
			onChange({ value, preset: 'custom' });
			popoverOpen = true;
			return;
		}
		// Switch to preset — drop any concrete range; encoder resolves at request time.
		onChange({ value: undefined, preset: id });
	}

	function handleCustomRange(range: { start: DateValue | undefined; end: DateValue | undefined }) {
		const start = range.start;
		const end = range.end;
		if (!start && !end) {
			onChange({ value: undefined, preset: 'custom' });
			return;
		}
		if (start && end) {
			onChange({
				value: {
					op: 'between',
					value: [dateValueToIsoStart(start), dateValueToIsoEnd(end)],
				},
				preset: 'custom',
			});
			return;
		}
		// Partial selection — keep open, don't emit yet.
		if (start && !end) {
			onChange({
				value: { op: 'gte', value: dateValueToIsoStart(start) },
				preset: 'custom',
			});
			return;
		}
		if (end && !start) {
			onChange({
				value: { op: 'lte', value: dateValueToIsoEnd(end) },
				preset: 'custom',
			});
		}
	}

	function summaryLabel(): string {
		if (preset && preset !== 'custom') {
			const p = PRESETS.find((x) => x.id === preset);
			return p ? $t(p.key) : '';
		}
		if (!value) return $t('app.search.filters.date_pick');
		const fmt = (iso: string) =>
			new Date(iso).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			});
		if (value.op === 'between') return `${fmt(value.value[0])} – ${fmt(value.value[1])}`;
		if (value.op === 'gte') return `≥ ${fmt(value.value)}`;
		if (value.op === 'lte') return `≤ ${fmt(value.value)}`;
		return fmt(value.value);
	}

	const showsCustom = $derived(preset === 'custom');
</script>

<FilterField label={$t('app.search.filters.date_label')} helpKey="app.search.filters.date_help">
	<div class="flex flex-wrap gap-1">
		{#each PRESETS as p (p.id)}
			{@const active = preset === p.id}
			<Button
				type="button"
				size="sm"
				variant={active ? 'default' : 'outline'}
				class="h-7 px-2 text-xs"
				onclick={() => handlePreset(p.id)}
			>
				{$t(p.key)}
			</Button>
		{/each}
	</div>

	{#if showsCustom}
		<Popover.Root bind:open={popoverOpen}>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="outline"
						size="sm"
						class="mt-1 w-full justify-start text-left font-normal"
					>
						<CalendarIcon class="mr-2 size-4" />
						{summaryLabel()}
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-auto p-0" align="start">
				{#await import('$lib/components/ui/range-calendar')}
					<div class="text-muted-foreground p-4 text-sm">
						{$t('app.search.filters.loading')}
					</div>
				{:then mod}
					{@const RangeCalendar = mod.RangeCalendar}
					{@const range = customRange()}
					<RangeCalendar
						value={{ start: range.start, end: range.end }}
						onValueChange={handleCustomRange}
						numberOfMonths={2}
					/>
				{:catch}
					<div class="text-destructive p-4 text-sm">
						{$t('app.search.filters.load_error')}
					</div>
				{/await}
			</Popover.Content>
		</Popover.Root>
	{:else}
		<p class="text-muted-foreground text-xs">{summaryLabel()}</p>
	{/if}
</FilterField>
