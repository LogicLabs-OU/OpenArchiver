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

	let { data }: { data: PageData } = $props();
	let searchResult = $derived(data.searchResult);
	let keywords = $state(data.keywords || '');
	let page = $derived(data.page);
	let error = $derived(data.error);
	let matchingStrategy: MatchingStrategy = $state(
		(data.matchingStrategy as MatchingStrategy) || 'last'
	);

	const strategies = [
		{ value: 'last', label: $t('app.search.strategy_fuzzy') },
		{ value: 'all', label: $t('app.search.strategy_verbatim') },
		{ value: 'frequency', label: $t('app.search.strategy_frequency') },
	];

	const triggerContent = $derived(
		strategies.find((s) => s.value === matchingStrategy)?.label ??
			$t('app.search.select_strategy')
	);

	function handleSearch(e: SubmitEvent) {
		e.preventDefault();
		const params = new URLSearchParams();
		params.set('keywords', keywords);
		params.set('page', '1');
		params.set('matchingStrategy', matchingStrategy);
		goto(`/dashboard/search?${params.toString()}`, { keepFocus: true });
	}
</script>

<svelte:head>
	<title>{$t('app.search.title')} | Open Archiver</title>
	<meta name="description" content={$t('app.search.description')} />
</svelte:head>

<div class="container mx-auto p-4 md:p-8">
	<h1 class="mb-4 text-2xl font-bold">{$t('app.search.email_search')}</h1>

	<form onsubmit={(e) => handleSearch(e)} class="mb-8 flex flex-col space-y-2">
		<div class="flex items-center gap-2">
			<Input
				type="search"
				name="keywords"
				placeholder={$t('app.search.placeholder')}
				class=" h-12 flex-grow"
				bind:value={keywords}
			/>
			<Button type="submit" class="h-12 cursor-pointer"
				>{$t('app.search.search_button')}</Button
			>
		</div>
		<div class="mt-1 text-xs font-medium">{$t('app.search.search_options')}</div>
		<div class="flex items-center gap-2">
			<Select.Root type="single" name="matchingStrategy" bind:value={matchingStrategy}>
				<Select.Trigger class=" w-[180px] cursor-pointer">
					{triggerContent}
				</Select.Trigger>
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

	{#if error}
		<Alert.Root variant="destructive">
			<CircleAlertIcon class="size-4" />
			<Alert.Title>{$t('app.search.error')}</Alert.Title>
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if searchResult}
		<p class="text-muted-foreground mb-4">
			{#if searchResult.total > 0}
				{$t('app.search.found_results_in', {
					total: searchResult.total,
					seconds: searchResult.processingTimeMs / 1000,
				} as any)}
			{:else}
				{$t('app.search.found_results', { total: searchResult.total } as any)}
			{/if}
		</p>

		<SearchResults {searchResult} />

		{#if searchResult.total > searchResult.limit}
			<div class="mt-8">
				<Pagination.Root count={searchResult.total} perPage={searchResult.limit} {page}>
					{#snippet children({ pages, currentPage })}
						<Pagination.Content>
							<Pagination.Item>
								<a
									href={`/dashboard/search?keywords=${keywords}&page=${
										currentPage - 1
									}&matchingStrategy=${matchingStrategy}`}
								>
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
										<a
											href={`/dashboard/search?keywords=${keywords}&page=${page.value}&matchingStrategy=${matchingStrategy}`}
										>
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
								<a
									href={`/dashboard/search?keywords=${keywords}&page=${
										currentPage + 1
									}&matchingStrategy=${matchingStrategy}`}
								>
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
