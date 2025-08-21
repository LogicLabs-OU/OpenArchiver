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

	let { data }: { data: PageData } = $props();
	let searchResult = $derived(data.searchResult);
	let keywords = $state(data.keywords || '');
	let page = $derived(data.page);
	let error = $derived(data.error);
	let matchingStrategy: MatchingStrategy = $state(
		(data.matchingStrategy as MatchingStrategy) || 'last'
	);

	const strategies = [
		{ value: 'last', label: 'Fuzzy' },
		{ value: 'all', label: 'Verbatim' },
		{ value: 'frequency', label: 'Frequency' },
	];

	const triggerContent = $derived(
		strategies.find((s) => s.value === matchingStrategy)?.label ?? 'Select a strategy'
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

	function handleSearch() {
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

	const getPaginationItems = (currentPage: number, totalPages: number, siblingCount = 1) => {
		const totalPageNumbers = siblingCount + 5;

		if (totalPages <= totalPageNumbers) {
			return Array.from({ length: totalPages }, (_, i) => i + 1);
		}

		const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
		const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);

		const shouldShowLeftDots = leftSiblingIndex > 2;
		const shouldShowRightDots = rightSiblingIndex < totalPages - 2;

		const firstPageIndex = 1;
		const lastPageIndex = totalPages;

		if (!shouldShowLeftDots && shouldShowRightDots) {
			let leftItemCount = 3 + 2 * siblingCount;
			let leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);
			return [...leftRange, '...', totalPages];
		}

		if (shouldShowLeftDots && !shouldShowRightDots) {
			let rightItemCount = 3 + 2 * siblingCount;
			let rightRange = Array.from(
				{ length: rightItemCount },
				(_, i) => totalPages - rightItemCount + i + 1
			);
			return [firstPageIndex, '...', ...rightRange];
		}

		if (shouldShowLeftDots && shouldShowRightDots) {
			let middleRange = Array.from(
				{ length: rightSiblingIndex - leftSiblingIndex + 1 },
				(_, i) => leftSiblingIndex + i
			);
			return [firstPageIndex, '...', ...middleRange, '...', lastPageIndex];
		}

		return [];
	};

	let paginationItems = $derived(
		getPaginationItems(
			page,
			Math.ceil((searchResult?.total || 0) / (searchResult?.limit || 10))
		)
	);
</script>

<svelte:head>
	<title>Search | Open Archiver</title>
	<meta name="description" content="Search for archived emails." />
</svelte:head>

<div class="container mx-auto p-4 md:p-8">
	<h1 class="mb-4 text-2xl font-bold">Email Search</h1>

	<form onsubmit={handleSearch} class="mb-8 flex flex-col space-y-2">
		<div class="flex items-center gap-2">
			<Input
				type="search"
				name="keywords"
				placeholder="Search by keyword, sender, recipient..."
				class=" h-12 flex-grow"
				bind:value={keywords}
			/>
			<Button type="submit" class="h-12 cursor-pointer">Search</Button>
		</div>
		<div class="mt-1 text-xs font-medium">Search options</div>
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
			<Alert.Title>Error</Alert.Title>
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if searchResult}
		<p class="text-muted-foreground mb-4">
			{#if searchResult.total > 0}
				Found {searchResult.total} results in {searchResult.processingTimeMs / 1000}s
			{:else}
				Found {searchResult.total} results
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
							<CardDescription class="flex items-center space-x-1">
								<span>From:</span>
								{#if !isMounted}
									<span class="bg-accent h-4 w-40 animate-pulse rounded-md"
									></span>
								{:else}
									<span
										class="inline-block"
										use:shadowRender={_formatted.from || hit.from}
									></span>
								{/if}
								<span class="mx-2">|</span>
								<span>To:</span>
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
								<span class="mx-2">|</span>
								{#if !isMounted}
									<span class="bg-accent h-4 w-40 animate-pulse rounded-md"
									></span>
								{:else}
									<span class="inline-block">
										{new Date(hit.timestamp).toLocaleString()}
									</span>
								{/if}
							</CardDescription>
						</CardHeader>
						<CardContent class="space-y-2">
							<!-- Body matches -->
							{#if _formatted.body}
								{#each getHighlightedSnippets(_formatted.body) as snippet}
									<div
										class="space-y-2 rounded-md bg-slate-100 p-2 dark:bg-slate-800"
									>
										<p class="text-sm text-gray-500">In email body:</p>
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
													In attachment: {attachment.filename}
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
			<div class="mt-8 flex flex-row items-center justify-center space-x-2">
				<a
					href={`/dashboard/search?keywords=${keywords}&page=${
						page - 1
					}&matchingStrategy=${matchingStrategy}`}
					class={page === 1 ? 'pointer-events-none' : ''}
				>
					<Button variant="outline" disabled={page === 1}>Prev</Button>
				</a>

				{#each paginationItems as item}
					{#if typeof item === 'number'}
						<a
							href={`/dashboard/search?keywords=${keywords}&page=${item}&matchingStrategy=${matchingStrategy}`}
						>
							<Button variant={item === page ? 'default' : 'outline'}>{item}</Button>
						</a>
					{:else}
						<span class="px-4 py-2">...</span>
					{/if}
				{/each}

				<a
					href={`/dashboard/search?keywords=${keywords}&page=${
						page + 1
					}&matchingStrategy=${matchingStrategy}`}
					class={page === Math.ceil(searchResult.total / searchResult.limit)
						? 'pointer-events-none'
						: ''}
				>
					<Button
						variant="outline"
						disabled={page === Math.ceil(searchResult.total / searchResult.limit)}
						>Next</Button
					>
				</a>
			</div>
		{/if}
	{/if}
</div>
