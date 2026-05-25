<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { goto } from '$app/navigation';
	import type { MatchingStrategy } from '@open-archiver/types';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { t } from '$lib/translations';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import SearchResults from './components/SearchResults.svelte';
	import AdvancedFilters from './components/AdvancedFilters.svelte';
	import ActiveFilterBadges from './components/ActiveFilterBadges.svelte';
	import SortControl from './components/SortControl.svelte';
	import { encodeSearchParams, emptyDraft } from './url-state';
	import type { SearchQueryDraft } from './url-state';
	import type { SortClause } from '@open-archiver/types';

	let { data }: { data: PageData } = $props();

	// `applied` is the last-applied state as decoded from the URL. `draft` is the
	// in-panel editor state. Per sub-plan §3a, panel edits do not auto-apply;
	// the user must press "Apply" or hit Enter in the search box (or remove a
	// chip in `ActiveFilterBadges`, which applies immediately).
	let applied = $derived(data.draft);
	// structuredClone($state.snapshot(...)) widens tuple value types (e.g. the
	// timestamp 'between' `[string, string]`) to plain arrays — re-cast through
	// `unknown` to keep the SearchQueryDraft shape.
	let draft = $state<SearchQueryDraft>(
		structuredClone($state.snapshot(data.draft)) as unknown as SearchQueryDraft
	);

	let searchResult = $derived(data.searchResult);
	let error = $derived(data.error);
	let ingestionSources = $derived(data.ingestionSources);

	// Whenever the URL changes (back/forward, external link), reset the local
	// draft to match.
	$effect(() => {
		draft = structuredClone($state.snapshot(applied)) as unknown as SearchQueryDraft;
	});

	const sourceOptions = $derived(
		ingestionSources.map((s) => ({
			id: s.id,
			name: s.name,
			providerType: s.provider,
		}))
	);

	const strategies = $derived([
		{ value: 'last', label: $t('app.search.strategy_fuzzy') },
		{ value: 'all', label: $t('app.search.strategy_verbatim') },
		{ value: 'frequency', label: $t('app.search.strategy_frequency') },
	]);

	const triggerContent = $derived(
		strategies.find((s) => s.value === draft.matchingStrategy)?.label ??
			$t('app.search.select_strategy')
	);

	function navigateWith(next: SearchQueryDraft) {
		const params = encodeSearchParams(next);
		const qs = params.toString();
		goto(`/dashboard/search${qs ? `?${qs}` : ''}`, { keepFocus: true });
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		// Enter in the search box applies the current draft (with page reset to 1).
		navigateWith({ ...draft, page: 1 });
	}

	function handleApply(next: SearchQueryDraft) {
		// Apply from the AdvancedFilters footer — reset to page 1.
		navigateWith({ ...next, page: 1 });
	}

	function handleSortChange(sort: SortClause[]) {
		// Sort picker applies immediately and resets pagination, like a chip
		// removal. The route owns navigation; SortControl is content-agnostic.
		const next: SearchQueryDraft = { ...draft, sort };
		draft = next;
		navigateWith({ ...next, page: 1 });
	}

	function handleClearAll() {
		// Per sub-plan §6.5 rollout: "Clear all → URL empties; results refresh."
		// We reset to a pristine draft.
		navigateWith(emptyDraft());
	}

	function handleRemoveBadge(key: string) {
		const filters = { ...(draft.filters ?? {}) };
		let nextDraft: SearchQueryDraft = { ...draft, filters };
		if (key === 'timestamp') {
			delete filters.timestamp;
			nextDraft = { ...nextDraft, datePreset: undefined };
		} else if (key in filters) {
			delete (filters as Record<string, unknown>)[key];
		}
		navigateWith({ ...nextDraft, page: 1 });
	}

	function pageHref(p: number): string {
		const params = encodeSearchParams({ ...draft, page: p });
		const qs = params.toString();
		return `/dashboard/search${qs ? `?${qs}` : ''}`;
	}
</script>

<svelte:head>
	<title>{$t('app.search.title')} | Open Archiver</title>
	<meta name="description" content={$t('app.search.description')} />
</svelte:head>

<div class="container mx-auto p-4 md:p-8">
	<h1 class="mb-4 text-2xl font-bold">{$t('app.search.email_search')}</h1>

	<form onsubmit={(e) => handleSubmit(e)} class="mb-4 flex flex-col space-y-2">
		<div class="flex items-center gap-2">
			<Input
				type="search"
				name="keywords"
				placeholder={$t('app.search.placeholder')}
				class="h-12 flex-grow"
				bind:value={draft.query}
			/>
			<Button type="submit" class="h-12 cursor-pointer">
				{$t('app.search.search_button')}
			</Button>
		</div>
		<div class="mt-1 text-xs font-medium">{$t('app.search.search_options')}</div>
		<div class="flex items-center gap-2">
			<Select.Root
				type="single"
				name="matchingStrategy"
				value={draft.matchingStrategy}
				onValueChange={(v: string) => {
					draft = { ...draft, matchingStrategy: v as MatchingStrategy };
				}}
			>
				<Select.Trigger class="w-[180px] cursor-pointer">{triggerContent}</Select.Trigger>
				<Select.Content>
					{#each strategies as strategy (strategy.value)}
						<Select.Item
							value={strategy.value}
							label={strategy.label}
							class="cursor-pointer"
						>
							{strategy.label}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</form>

	<div class="mb-4">
		<AdvancedFilters
			bind:draft
			{applied}
			sources={sourceOptions}
			onApply={handleApply}
			onClearAll={handleClearAll}
		/>
	</div>

	<ActiveFilterBadges draft={applied} sources={sourceOptions} onRemove={handleRemoveBadge} />

	{#if error}
		<Alert.Root variant="destructive">
			<CircleAlertIcon class="size-4" />
			<Alert.Title>{$t('app.search.error')}</Alert.Title>
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if searchResult}
		{#if searchResult.total > 0}
			<div class="mb-4 flex items-center justify-between gap-2">
				<p class="text-muted-foreground">
					{$t('app.search.found_results_in', {
						total: searchResult.total,
						seconds: searchResult.processingTimeMs / 1000,
					} as any)}
				</p>
				<SortControl
					sort={draft.sort}
					hasQuery={Boolean((draft.query ?? '').trim())}
					onChange={handleSortChange}
				/>
			</div>
		{:else}
			<p class="text-muted-foreground mb-4">
				{$t('app.search.found_results', { total: searchResult.total } as any)}
			</p>
		{/if}

		<SearchResults {searchResult} />

		{#if searchResult.total > searchResult.limit}
			<div class="mt-8">
				<Pagination.Root
					count={searchResult.total}
					perPage={searchResult.limit}
					page={applied.page}
				>
					{#snippet children({ pages, currentPage })}
						<Pagination.Content>
							<Pagination.Item>
								<a href={pageHref(currentPage - 1)}>
									<Pagination.PrevButton>
										<ChevronLeft class="h-4 w-4" />
										<span class="hidden sm:block">{$t('app.search.prev')}</span>
									</Pagination.PrevButton>
								</a>
							</Pagination.Item>
							{#each pages as page (page.key)}
								{#if page.type === 'ellipsis'}
									<Pagination.Item>
										<Pagination.Ellipsis />
									</Pagination.Item>
								{:else}
									<Pagination.Item>
										<a href={pageHref(page.value)}>
											<Pagination.Link
												{page}
												isActive={currentPage === page.value}
											>
												{page.value}
											</Pagination.Link>
										</a>
									</Pagination.Item>
								{/if}
							{/each}
							<Pagination.Item>
								<a href={pageHref(currentPage + 1)}>
									<Pagination.NextButton>
										<span class="hidden sm:block">{$t('app.search.next')}</span>
										<ChevronRight class="h-4 w-4" />
									</Pagination.NextButton>
								</a>
							</Pagination.Item>
						</Pagination.Content>
					{/snippet}
				</Pagination.Root>
			</div>
		{/if}
	{/if}
</div>
