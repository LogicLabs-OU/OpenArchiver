<script lang="ts">
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Select from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ChipInput from './ChipInput.svelte';
	import { ChevronDown, X } from 'lucide-svelte';
	import { t } from '$lib/translations';
	import { api } from '$lib/api.client';
	import type { SearchFacetResult } from '@open-archiver/types';

	/** Permission-scoped typeahead suggestions for a facet field (e.g. mailboxes). */
	const loadFacet = (field: string) => async (query: string) => {
		try {
			const res = await api(
				`/search/facets?field=${field}&query=${encodeURIComponent(query)}`
			);
			if (!res.ok) return [];
			const data = (await res.json()) as SearchFacetResult;
			return data.values ?? [];
		} catch {
			return [];
		}
	};
	const loadMailboxSuggestions = loadFacet('mailboxes');

	let {
		availableSources = null,
		selectedSources = $bindable([]),
		excludedSources = $bindable([]),
		fromAddresses = $bindable([]),
		notFromAddresses = $bindable([]),
		toAddresses = $bindable([]),
		notToAddresses = $bindable([]),
		mailboxes = $bindable([]),
		dateFrom = $bindable(''),
		dateTo = $bindable(''),
		searchIn = $bindable([]),
		hasAttachments = $bindable('any'),
		sort = $bindable('date_desc'),
	}: {
		/** null = the user cannot list ingestion sources (no read:ingestion permission). */
		availableSources?: { id: string; name: string }[] | null;
		selectedSources?: string[];
		excludedSources?: string[];
		fromAddresses?: string[];
		notFromAddresses?: string[];
		toAddresses?: string[];
		notToAddresses?: string[];
		mailboxes?: string[];
		dateFrom?: string;
		dateTo?: string;
		searchIn?: string[];
		hasAttachments?: string;
		sort?: string;
	} = $props();

	let open = $state(true);

	const scopes = [
		'subject',
		'body',
		'attachment_name',
		'attachment_content',
		'from',
		'to',
	] as const;

	const activeCount = $derived(
		[
			selectedSources.length > 0,
			excludedSources.length > 0,
			fromAddresses.length > 0,
			notFromAddresses.length > 0,
			toAddresses.length > 0,
			notToAddresses.length > 0,
			mailboxes.length > 0,
			!!dateFrom || !!dateTo,
			searchIn.length > 0,
			hasAttachments !== 'any',
			sort !== 'date_desc',
		].filter(Boolean).length
	);

	// Date range uses native date inputs (bound to the yyyy-mm-dd string props): typeable
	// for long spans, with a built-in picker, and no parsing/locale plumbing needed.
	const clearDates = () => {
		dateFrom = '';
		dateTo = '';
	};

	const toggleScope = (scope: string, checked: boolean) => {
		searchIn = checked ? [...searchIn, scope] : searchIn.filter((s) => s !== scope);
	};

	const toggleSource = (list: 'include' | 'exclude', id: string, checked: boolean) => {
		if (list === 'include') {
			selectedSources = checked
				? [...selectedSources, id]
				: selectedSources.filter((s) => s !== id);
			// A source can't be both included and excluded; drop it from the other list.
			if (checked) excludedSources = excludedSources.filter((s) => s !== id);
		} else {
			excludedSources = checked
				? [...excludedSources, id]
				: excludedSources.filter((s) => s !== id);
			if (checked) selectedSources = selectedSources.filter((s) => s !== id);
		}
	};

	const clearAll = () => {
		selectedSources = [];
		excludedSources = [];
		fromAddresses = [];
		notFromAddresses = [];
		toAddresses = [];
		notToAddresses = [];
		mailboxes = [];
		dateFrom = '';
		dateTo = '';
		searchIn = [];
		hasAttachments = 'any';
		sort = 'date_desc';
	};

	const sourceDropdownLabel = (ids: string[], fallback: string) =>
		ids.length > 0 ? `${fallback} (${ids.length})` : fallback;

	const attachmentOptions = $derived([
		{ value: 'any', label: $t('app.search.attachments_any') },
		{ value: 'true', label: $t('app.search.attachments_with') },
		{ value: 'false', label: $t('app.search.attachments_without') },
	]);
	const sortOptions = $derived([
		{ value: 'date_desc', label: $t('app.search.sort_newest') },
		{ value: 'date_asc', label: $t('app.search.sort_oldest') },
		{ value: 'relevance', label: $t('app.search.sort_relevance') },
	]);
	const attachmentTrigger = $derived(
		attachmentOptions.find((o) => o.value === hasAttachments)?.label ??
			$t('app.search.attachments_any')
	);
	const sortTrigger = $derived(
		sortOptions.find((o) => o.value === sort)?.label ?? $t('app.search.sort_newest')
	);
</script>

<Collapsible.Root bind:open class="rounded-lg border">
	<Collapsible.Trigger
		class="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-sm font-medium"
	>
		<ChevronDown class="size-4 transition-transform {open ? 'rotate-180' : ''}" />
		{$t('app.search.advanced_search')}
		{#if activeCount > 0}
			<Badge variant="secondary">{activeCount}</Badge>
		{/if}
	</Collapsible.Trigger>
	<Collapsible.Content>
		<div class="grid gap-4 border-t p-4">
			{#if availableSources && availableSources.length > 0}
				<div class="space-y-1.5">
					<Label>{$t('app.search.sources')}</Label>
					<div class="flex flex-wrap gap-2">
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="outline" size="sm">
										{sourceDropdownLabel(
											selectedSources,
											$t('app.search.include_sources')
										)}
										<ChevronDown class="ml-1 size-4" />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="max-h-72 overflow-y-auto">
								{#each availableSources as source (source.id)}
									<DropdownMenu.CheckboxItem
										checked={selectedSources.includes(source.id)}
										onCheckedChange={(checked) =>
											toggleSource('include', source.id, checked === true)}
									>
										{source.name}
									</DropdownMenu.CheckboxItem>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="outline" size="sm">
										{sourceDropdownLabel(
											excludedSources,
											$t('app.search.exclude_sources')
										)}
										<ChevronDown class="ml-1 size-4" />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="max-h-72 overflow-y-auto">
								{#each availableSources as source (source.id)}
									<DropdownMenu.CheckboxItem
										checked={excludedSources.includes(source.id)}
										onCheckedChange={(checked) =>
											toggleSource('exclude', source.id, checked === true)}
									>
										{source.name}
									</DropdownMenu.CheckboxItem>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				</div>
			{/if}

			<div class="space-y-1.5">
				<Label>{$t('app.search.date_range')}</Label>
				<div class="grid grid-cols-2 gap-2">
					<div class="space-y-1">
						<Label for="date-from" class="text-muted-foreground text-xs font-normal">
							{$t('app.search.date_from')}
						</Label>
						<Input
							id="date-from"
							type="date"
							class="cursor-pointer"
							max={dateTo || undefined}
							bind:value={dateFrom}
						/>
					</div>
					<div class="space-y-1">
						<Label for="date-to" class="text-muted-foreground text-xs font-normal">
							{$t('app.search.date_to')}
						</Label>
						<Input
							id="date-to"
							type="date"
							class="cursor-pointer"
							min={dateFrom || undefined}
							bind:value={dateTo}
						/>
					</div>
				</div>
				{#if dateFrom || dateTo}
					<Button variant="ghost" size="sm" class="h-7 px-2" onclick={clearDates}>
						<X class="mr-1 size-3" />
						{$t('app.search.clear_dates')}
					</Button>
				{/if}
			</div>

			<div class="space-y-1.5">
				<Label for="filter-from">{$t('app.search.from_filter')}</Label>
				<ChipInput
					id="filter-from"
					bind:values={fromAddresses}
					placeholder={$t('app.search.add_value_hint')}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="filter-not-from">{$t('app.search.exclude_from')}</Label>
				<ChipInput
					id="filter-not-from"
					bind:values={notFromAddresses}
					placeholder={$t('app.search.add_value_hint')}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="filter-to">{$t('app.search.to_filter')}</Label>
				<ChipInput
					id="filter-to"
					bind:values={toAddresses}
					placeholder={$t('app.search.add_value_hint')}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="filter-not-to">{$t('app.search.exclude_to')}</Label>
				<ChipInput
					id="filter-not-to"
					bind:values={notToAddresses}
					placeholder={$t('app.search.add_value_hint')}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="filter-mailboxes">{$t('app.search.mailboxes')}</Label>
				<ChipInput
					id="filter-mailboxes"
					bind:values={mailboxes}
					placeholder={$t('app.search.add_value_hint')}
					loadSuggestions={loadMailboxSuggestions}
				/>
			</div>

			<div class="space-y-1.5">
				<Label>{$t('app.search.search_in')}</Label>
				<div class="flex flex-wrap gap-x-4 gap-y-2">
					{#each scopes as scope (scope)}
						<div class="flex items-center gap-1.5">
							<Checkbox
								id="scope-{scope}"
								checked={searchIn.includes(scope)}
								onCheckedChange={(checked) => toggleScope(scope, checked === true)}
							/>
							<Label for="scope-{scope}" class="cursor-pointer font-normal">
								{$t(`app.search.scope_${scope}`)}
							</Label>
						</div>
					{/each}
				</div>
			</div>

			<div class="space-y-1.5">
				<Label>{$t('app.search.attachments_filter')}</Label>
				<Select.Root type="single" bind:value={hasAttachments}>
					<Select.Trigger class="w-full cursor-pointer">
						{attachmentTrigger}
					</Select.Trigger>
					<Select.Content>
						{#each attachmentOptions as option (option.value)}
							<Select.Item
								value={option.value}
								label={option.label}
								class="cursor-pointer"
							>
								{option.label}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="space-y-1.5">
				<Label>{$t('app.search.sort_by')}</Label>
				<Select.Root type="single" bind:value={sort}>
					<Select.Trigger class="w-full cursor-pointer">
						{sortTrigger}
					</Select.Trigger>
					<Select.Content>
						{#each sortOptions as option (option.value)}
							<Select.Item
								value={option.value}
								label={option.label}
								class="cursor-pointer"
							>
								{option.label}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>
		{#if activeCount > 0}
			<div class="border-t px-4 py-2">
				<Button variant="ghost" size="sm" onclick={clearAll}>
					<X class="mr-1 size-4" />
					{$t('app.search.clear_filters')}
				</Button>
			</div>
		{/if}
	</Collapsible.Content>
</Collapsible.Root>
