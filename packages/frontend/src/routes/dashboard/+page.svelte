<script lang="ts">
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card/index.js';
	import { formatBytes } from '$lib/utils';
	import EmptyState from '$lib/components/custom/EmptyState.svelte';
	import { goto } from '$app/navigation';
	import { Archive, CircleAlert, HardDrive } from 'lucide-svelte';
	import TopSendersChart from '$lib/components/custom/charts/TopSendersChart.svelte';
	import IngestionHistoryChart from '$lib/components/custom/charts/IngestionHistoryChart.svelte';
	import StorageBySourceChart from '$lib/components/custom/charts/StorageBySourceChart.svelte';
	let { data }: { data: PageData } = $props();

	const transformedHistory = $derived(
		data.ingestionHistory?.history.map((item) => ({
			...item,
			date: new Date(item.date),
		})) ?? []
	);
</script>

<svelte:head>
	<title>Dashboard - OpenArchiver</title>
	<meta name="description" content="Overview of your email archive." />
</svelte:head>

<div class="flex-1 space-y-4">
	<div class="flex items-center justify-between space-y-2">
		<h2 class="text-3xl font-bold tracking-tight">Dashboard</h2>
	</div>
	{#if !data.ingestionSources || data.ingestionSources?.length === 0}
		<div>
			<EmptyState
				buttonText="Create an ingestion"
				header="You don't have any ingestion source set up."
				text="Add an ingestion source to start archiving your inboxes."
				click={() => {
					goto('/dashboard/ingestions');
				}}
			></EmptyState>
		</div>
	{:else}
		<!-- show data -->
		<div class="space-y-4">
			{#if data.stats}
				<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					<Card.Root>
						<Card.Header
							class="flex flex-row items-center justify-between space-y-0 pb-2"
						>
							<Card.Title class="text-sm font-medium"
								>Total Emails Archived</Card.Title
							>
							<Archive class="text-muted-foreground h-4 w-4" />
						</Card.Header>
						<Card.Content>
							<div class="text-primary text-2xl font-bold">
								{data.stats.totalEmailsArchived}
							</div>
						</Card.Content>
					</Card.Root>
					<Card.Root>
						<Card.Header
							class="flex flex-row items-center justify-between space-y-0 pb-2"
						>
							<Card.Title class="text-sm font-medium">Total Storage Used</Card.Title>
							<HardDrive class="text-muted-foreground h-4 w-4" />
						</Card.Header>
						<Card.Content>
							<div class="text-primary text-2xl font-bold">
								{formatBytes(data.stats.totalStorageUsed)}
							</div>
						</Card.Content>
					</Card.Root>
					<Card.Root class="">
						<Card.Header
							class="flex flex-row items-center justify-between space-y-0 pb-2"
						>
							<Card.Title class="text-sm font-medium"
								>Failed Ingestions (Last 7 Days)</Card.Title
							>
							<CircleAlert class=" text-muted-foreground h-4 w-4" />
						</Card.Header>
						<Card.Content>
							<div
								class=" text-2xl font-bold"
								class:text-destructive={data.stats.failedIngestionsLast7Days > 0}
								class:text-green-600={data.stats.failedIngestionsLast7Days <= 0}
							>
								{data.stats.failedIngestionsLast7Days}
							</div>
						</Card.Content>
					</Card.Root>
				</div>
			{/if}

			<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<div class=" lg:col-span-2">
					<Card.Root>
						<Card.Header>
							<Card.Title>Ingestion History</Card.Title>
						</Card.Header>
						<Card.Content class=" pl-4">
							{#if transformedHistory.length > 0}
								<IngestionHistoryChart data={transformedHistory} />
							{:else}
								<p>No ingestion history available.</p>
							{/if}
						</Card.Content>
					</Card.Root>
				</div>
				<div class=" lg:col-span-1">
					<Card.Root class="h-full">
						<Card.Header>
							<Card.Title>Storage by Ingestion Source</Card.Title>
						</Card.Header>
						<Card.Content class="h-full">
							{#if data.ingestionSources && data.ingestionSources.length > 0}
								<StorageBySourceChart data={data.ingestionSources} />
							{:else}
								<p>No ingestion sources available.</p>
							{/if}
						</Card.Content>
					</Card.Root>
				</div>
			</div>
			<div>
				<h1 class="text-xl font-semibold leading-6">Indexed insights</h1>
			</div>
			<div class="grid grid-cols-1">
				<Card.Root>
					<Card.Header>
						<Card.Title>Top 10 Senders</Card.Title>
					</Card.Header>
					<Card.Content>
						{#if data.indexedInsights && data.indexedInsights.topSenders.length > 0}
							<TopSendersChart data={data.indexedInsights.topSenders} />
						{:else}
							<p>No indexed insights available.</p>
						{/if}
					</Card.Content>
				</Card.Root>
			</div>
		</div>
	{/if}
</div>
