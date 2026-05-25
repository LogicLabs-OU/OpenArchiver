<script lang="ts">
	/**
	 * SortControl — single-select sort dropdown above the results list.
	 *
	 * Refs:
	 *   - issue #298 (sort by date)
	 *   - issue #304 (sort columns)
	 *   - docs/plans/advanced-search.md §10 (P4 sub-plan)
	 *
	 * The component is content-agnostic: the route owns layout (right-aligned in
	 * the results-count row) and navigation. We emit a `SortClause[]` upstream
	 * via `onChange`; the route persists it to the URL.
	 *
	 * Item semantics:
	 *   - "Relevance" → `[]` (let Meilisearch rank by relevance). Hidden when
	 *     there is no keyword query — relevance has no meaning on a
	 *     filter-only browse.
	 *   - All other items emit a single concrete `SortClause`.
	 *
	 * `sort=[]` is interpreted as:
	 *   - "Relevance" when `hasQuery` is true.
	 *   - The implicit "Newest first" default when `hasQuery` is false (matches
	 *     the precedence rule in `toApiSearchQuery`).
	 */
	import type { SortClause } from '@open-archiver/types';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import { t } from '$lib/translations';

	type Props = {
		sort: SortClause[];
		hasQuery: boolean;
		onChange: (sort: SortClause[]) => void;
	};

	let { sort, hasQuery, onChange }: Props = $props();

	type Preset = {
		id: string;
		labelKey: string;
		value: SortClause[];
	};

	const PRESETS: Preset[] = [
		{
			id: 'date_desc',
			labelKey: 'app.search.sort.date_desc',
			value: [{ field: 'timestamp', dir: 'desc' }],
		},
		{
			id: 'date_asc',
			labelKey: 'app.search.sort.date_asc',
			value: [{ field: 'timestamp', dir: 'asc' }],
		},
		{
			id: 'from_asc',
			labelKey: 'app.search.sort.from_asc',
			value: [{ field: 'from', dir: 'asc' }],
		},
		{
			id: 'subject_asc',
			labelKey: 'app.search.sort.subject_asc',
			value: [{ field: 'subject', dir: 'asc' }],
		},
		{
			id: 'size_desc',
			labelKey: 'app.search.sort.size_desc',
			value: [{ field: 'sizeBytes', dir: 'desc' }],
		},
		{
			id: 'size_asc',
			labelKey: 'app.search.sort.size_asc',
			value: [{ field: 'sizeBytes', dir: 'asc' }],
		},
	];

	// Find which preset (if any) the current `sort` matches.
	const matchedPreset = $derived.by(() => {
		if (!sort || sort.length === 0) return null;
		const s = sort[0];
		return (
			PRESETS.find((p) => p.value[0].field === s.field && p.value[0].dir === s.dir) ?? null
		);
	});

	// Identifier of the currently-active item (drives the radio-group highlight).
	const activeId = $derived.by(() => {
		if (!sort || sort.length === 0) {
			return hasQuery ? 'relevance' : 'date_desc';
		}
		return matchedPreset?.id ?? 'custom';
	});

	const triggerLabelKey = $derived.by(() => {
		if (!sort || sort.length === 0) {
			return hasQuery ? 'app.search.sort.relevance' : 'app.search.sort.date_desc';
		}
		return matchedPreset?.labelKey ?? 'app.search.sort.custom';
	});

	function pick(value: SortClause[]) {
		onChange(value);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				size="sm"
				class="cursor-pointer gap-2"
				aria-label={$t('app.search.sort.label')}
			>
				<ArrowUpDownIcon class="h-4 w-4" />
				<span>{$t('app.search.sort.label')}: {$t(triggerLabelKey)}</span>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="min-w-[12rem]">
		{#if hasQuery}
			<DropdownMenu.Item
				class="cursor-pointer"
				data-active={activeId === 'relevance' ? '' : undefined}
				onclick={() => pick([])}
			>
				{$t('app.search.sort.relevance')}
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
		{/if}
		{#each PRESETS as preset (preset.id)}
			<DropdownMenu.Item
				class="cursor-pointer"
				data-active={activeId === preset.id ? '' : undefined}
				onclick={() => pick(preset.value)}
			>
				{$t(preset.labelKey)}
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
