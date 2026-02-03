<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import {
		Card,
		CardContent,
		CardHeader,
		CardTitle,
		CardDescription,
	} from '$lib/components/ui/card';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { MatchingStrategy } from '@open-archiver/types';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { t } from '$lib/translations';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';

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

	let isMounted = $state(false);
	onMount(() => {
		isMounted = true;
	});

	function shadowRender(node: HTMLElement, html: string | undefined) {
		if (html === undefined) return;

		const shadow = node.attachShadow({ mode: 'open' });
		const style = document.createElement('style');
		style.textContent = `em { background-color: #fde047; font-style: normal; color: #1f2937; }`; // yellow-300, gray-800
		shadow.appendChild(style);
		const content = document.createElement('div');
		content.innerHTML = html;
		shadow.appendChild(content);

		return {
			update(newHtml: string | undefined) {
				if (newHtml === undefined) return;
				content.innerHTML = newHtml;
			},
		};
	}

	function handleSearch(e: SubmitEvent) {
		e.preventDefault();
		const params = new URLSearchParams();
		params.set('keywords', keywords);
		params.set('page', '1');
		params.set('matchingStrategy', matchingStrategy);
		goto(`/dashboard/search?${params.toString()}`, { keepFocus: true });
	}

	function getHighlightedSnippets(text: string | undefined, snippetLength = 80): string[] {
		if (!text || !text.includes('<em>')) {
			return [];
		}

		const snippets: string[] = [];
		const regex = /<em>.*?<\/em>/g;
		let match;
		let lastIndex = 0;

		while ((match = regex.exec(text)) !== null) {
			if (match.index < lastIndex) {
				continue;
			}

			const matchIndex = match.index;
			const matchLength = match[0].length;

			const start = Math.max(0, matchIndex - snippetLength);
			const end = Math.min(text.length, matchIndex + matchLength + snippetLength);

			lastIndex = end;

			let snippet = text.substring(start, end);

			// Then, balance them
			const openCount = (snippet.match(/<em/g) || []).length;
			const closeCount = (snippet.match(/<\/em>/g) || []).length;

			if (openCount > closeCount) {
				snippet += '</em>';
			}

			if (closeCount > openCount) {
				snippet = '<em>' + snippet;
			}

			// Finally, add ellipsis
			if (start > 0) {
				snippet = '...' + snippet;
			}
			if (end < text.length) {
				snippet += '...';
			}

			snippets.push(snippet);
		}

		return snippets;
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

		<div class="grid gap-4">
			{#each searchResult.hits as hit}
				{@const _formatted = hit._formatted || {}}
				<a href="/dashboard/archived-emails/{hit.id}" class="block">
					<Card>
						<CardHeader>
							<CardTitle>
								{#if !isMounted}
									<Skeleton class="h-6 w-3/4" />
								{:else}
									<div use:shadowRender={_formatted.subject || hit.subject}></div>
								{/if}
							</CardTitle>
							<CardDescription
								class="divide-forground flex flex-wrap items-center space-x-2 divide-x"
							>
								<span class="pr-2">
									<span>{$t('app.search.from')}:</span>
									{#if !isMounted}
										<span class="bg-accent h-4 w-40 animate-pulse rounded-md"
										></span>
									{:else}
										<span
											class="inline-block"
											use:shadowRender={_formatted.from || hit.from}
										></span>
									{/if}
								</span>
								<span class="pr-2">
									<span>{$t('app.search.to')}:</span>
									{#if !isMounted}
										<span class="bg-accent h-4 w-40 animate-pulse rounded-md"
										></span>
									{:else}
										<span
											class="inline-block"
											use:shadowRender={_formatted.to?.join(', ') ||
												hit.to.join(', ')}
										></span>
									{/if}
								</span>
								<span>
									{#if !isMounted}
										<span class="bg-accent h-4 w-40 animate-pulse rounded-md"
										></span>
									{:else}
										<span class="inline-block">
											{new Date(hit.timestamp).toLocaleString()}
										</span>
									{/if}
								</span>
							</CardDescription>
						</CardHeader>
						<CardContent class="space-y-2">
							<!-- Body matches -->
							{#if _formatted.body}
								{#each getHighlightedSnippets(_formatted.body) as snippet}
									<div
										class="space-y-2 rounded-md bg-slate-100 p-2 dark:bg-slate-800"
									>
										<p class="text-sm text-gray-500">
											{$t('app.search.in_email_body')}:
										</p>
										{#if !isMounted}
											<Skeleton class="my-2 h-5 w-full bg-gray-200" />
										{:else}
											<p
												class="font-mono text-sm"
												use:shadowRender={snippet}
											></p>
										{/if}
									</div>
								{/each}
							{/if}

							<!-- Attachment matches -->
							{#if _formatted.attachments}
								{#each _formatted.attachments as attachment, i}
									{#if attachment && attachment.content}
										{#each getHighlightedSnippets(attachment.content) as snippet}
											<div
												class="space-y-2 rounded-md bg-slate-100 p-2 dark:bg-slate-800"
											>
												<p class="text-sm text-gray-500">
													{$t('app.search.in_attachment', {
														filename: attachment.filename,
													} as any)}
												</p>
												{#if !isMounted}
													<Skeleton class="my-2 h-5 w-full bg-gray-200" />
												{:else}
													<p
														class="font-mono text-sm"
														use:shadowRender={snippet}
													></p>
												{/if}
											</div>
										{/each}
									{/if}
								{/each}
							{/if}
						</CardContent>
					</Card>
				</a>
			{/each}
		</div>

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
