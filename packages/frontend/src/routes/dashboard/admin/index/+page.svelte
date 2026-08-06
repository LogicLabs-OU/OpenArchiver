<script lang="ts">
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import { formatBytes } from '$lib/utils';
	import { formatDistanceToNow } from 'date-fns';
	import { goto } from '$app/navigation';
	import { Server, Database, HeartPulse, HardDrive, Clock, FileText } from 'lucide-svelte';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import type { SearchTaskStatus } from '@open-archiver/types';
	import { t } from '$lib/translations';

	let { data }: { data: PageData } = $props();
	let overview = $derived(data.overview);
	let tasks = $derived(data.tasks);
	let selectedStatus = $derived(data.filters.status);

	// '' means "All".
	const statusFilters: ('' | SearchTaskStatus)[] = [
		'',
		'succeeded',
		'processing',
		'enqueued',
		'failed',
		'canceled',
	];

	const relative = (d: string | null) => {
		if (!d) return '—';
		try {
			return formatDistanceToNow(new Date(d), { addSuffix: true });
		} catch {
			return '—';
		}
	};

	const statusVariant = (
		s: SearchTaskStatus
	): 'default' | 'secondary' | 'destructive' | 'outline' => {
		if (s === 'failed' || s === 'canceled') return 'destructive';
		if (s === 'succeeded') return 'default';
		return 'secondary';
	};

	function applyStatus(status: '' | SearchTaskStatus) {
		const url = new URL(window.location.href);
		if (status) url.searchParams.set('status', status);
		else url.searchParams.delete('status');
		// Reset the cursor when the filter changes.
		url.searchParams.delete('from');
		goto(url.toString(), { invalidateAll: true });
	}

	function pageOlder() {
		if (tasks.next == null) return;
		const url = new URL(window.location.href);
		url.searchParams.set('from', String(tasks.next));
		goto(url.toString(), { invalidateAll: true });
	}

	function pageLatest() {
		const url = new URL(window.location.href);
		url.searchParams.delete('from');
		goto(url.toString(), { invalidateAll: true });
	}

	// Field distribution as a sorted [field, count] list.
	let fieldDistribution = $derived(
		overview.index
			? Object.entries(overview.index.fieldDistribution).sort(([, a], [, b]) => b - a)
			: []
	);
</script>

<svelte:head>
	<title>{$t('app.index_admin.title')} - Open Archiver</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold">{$t('app.index_admin.title')}</h1>

	<!-- Instance overview -->
	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">{$t('app.index_admin.host')}</Card.Title>
				<Server class="text-muted-foreground h-4 w-4" />
			</Card.Header>
			<Card.Content>
				<div class="truncate text-lg font-bold" title={overview.host}>{overview.host}</div>
				<p class="text-muted-foreground mt-1 text-xs">
					{$t('app.index_admin.version')}: {overview.version?.pkgVersion ?? '—'}
				</p>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">{$t('app.index_admin.health')}</Card.Title>
				<HeartPulse class="text-muted-foreground h-4 w-4" />
			</Card.Header>
			<Card.Content>
				<Badge variant={overview.health === 'available' ? 'default' : 'destructive'}>
					{overview.health}
				</Badge>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">{$t('app.index_admin.database_size')}</Card.Title>
				<HardDrive class="text-muted-foreground h-4 w-4" />
			</Card.Header>
			<Card.Content>
				<div class="text-primary text-2xl font-bold">{formatBytes(overview.databaseSize)}</div>
				<p class="text-muted-foreground mt-1 text-xs">
					{$t('app.index_admin.used')}: {formatBytes(overview.usedDatabaseSize)}
				</p>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">{$t('app.index_admin.last_update')}</Card.Title>
				<Clock class="text-muted-foreground h-4 w-4" />
			</Card.Header>
			<Card.Content>
				<div class="text-lg font-bold">{relative(overview.lastUpdate)}</div>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Emails index -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<Database class="h-4 w-4" />
				{overview.index?.uid ?? 'emails'}
			</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if overview.index}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<div>
						<p class="text-muted-foreground text-xs">{$t('app.index_admin.documents')}</p>
						<p class="text-primary text-2xl font-bold">
							{overview.index.numberOfDocuments.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-muted-foreground text-xs">{$t('app.index_admin.primary_key')}</p>
						<p class="font-mono text-sm">{overview.index.primaryKey ?? '—'}</p>
					</div>
					<div>
						<p class="text-muted-foreground text-xs">{$t('app.index_admin.indexing')}</p>
						<Badge variant={overview.index.isIndexing ? 'secondary' : 'outline'}>
							{overview.index.isIndexing ? $t('app.index_admin.yes') : $t('app.index_admin.no')}
						</Badge>
					</div>
					<div>
						<p class="text-muted-foreground text-xs">{$t('app.index_admin.updated_at')}</p>
						<p class="text-sm">{relative(overview.index.updatedAt)}</p>
					</div>
				</div>

				{#if fieldDistribution.length > 0}
					<div class="mt-6">
						<p class="text-muted-foreground mb-2 text-xs">
							{$t('app.index_admin.field_distribution')}
						</p>
						<div class="flex flex-wrap gap-2">
							{#each fieldDistribution as [field, count] (field)}
								<Badge variant="outline" class="font-mono">
									{field}: {count.toLocaleString()}
								</Badge>
							{/each}
						</div>
					</div>
				{/if}
			{:else}
				<p class="text-muted-foreground text-sm">{$t('app.index_admin.no_index')}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Documents by ingestion source (counts straight from Meilisearch facets) -->
	{#if overview.documentsBySource.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<Database class="h-4 w-4" />
					{$t('app.index_admin.documents_by_source')}
				</Card.Title>
			</Card.Header>
			<Card.Content>
				<div class="rounded-md border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>{$t('app.index_admin.source')}</Table.Head>
								<Table.Head class="text-right">{$t('app.index_admin.documents')}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each overview.documentsBySource as row (row.ingestionSourceId)}
								<Table.Row>
									<Table.Cell>
										{#if row.name}
											<a class="link" href="/dashboard/ingestions/{row.ingestionSourceId}"
												>{row.name}</a
											>
										{:else}
											<span class="text-muted-foreground font-mono text-xs"
												>{row.ingestionSourceId}
												<span class="italic">({$t('app.index_admin.deleted_source')})</span></span
											>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right font-medium">
										{row.count.toLocaleString()}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- Tasks -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<FileText class="h-4 w-4" />
				{$t('app.index_admin.tasks')}
			</Card.Title>
			<div class="flex flex-wrap gap-2 pt-2">
				{#each statusFilters as status (status)}
					<Button
						variant={selectedStatus === status ? 'default' : 'outline'}
						size="sm"
						class="capitalize"
						onclick={() => applyStatus(status)}
					>
						{status === '' ? $t('app.index_admin.all') : status}
					</Button>
				{/each}
			</div>
		</Card.Header>
		<Card.Content>
			<div class="rounded-md border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{$t('app.index_admin.task_uid')}</Table.Head>
							<Table.Head>{$t('app.index_admin.task_type')}</Table.Head>
							<Table.Head>{$t('app.index_admin.status')}</Table.Head>
							<Table.Head class="text-right">{$t('app.index_admin.documents')}</Table.Head>
							<Table.Head>{$t('app.index_admin.duration')}</Table.Head>
							<Table.Head>{$t('app.index_admin.enqueued_at')}</Table.Head>
							<Table.Head>{$t('app.index_admin.finished_at')}</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each tasks.results as task (task.uid)}
							<Table.Row>
								<Table.Cell class="font-mono">{task.uid}</Table.Cell>
								<Table.Cell class="text-sm">{task.type}</Table.Cell>
								<Table.Cell>
									{#if task.error}
										<Button
											variant={statusVariant(task.status)}
											size="sm"
											class="capitalize"
											onclick={() => {
												const el = document.getElementById(`task-error-${task.uid}`);
												if (el) el.classList.toggle('hidden');
											}}
										>
											{task.status}
										</Button>
									{:else}
										<Badge variant={statusVariant(task.status)} class="capitalize">
											{task.status}
										</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right">
									{#if task.details?.indexedDocuments != null || task.details?.receivedDocuments != null}
										{(task.details?.indexedDocuments ?? 0).toLocaleString()} /
										{(task.details?.receivedDocuments ?? 0).toLocaleString()}
									{:else}
										—
									{/if}
								</Table.Cell>
								<Table.Cell class="font-mono text-sm">{task.duration ?? '—'}</Table.Cell>
								<Table.Cell class="text-sm" title={task.enqueuedAt}>
									{relative(task.enqueuedAt)}
								</Table.Cell>
								<Table.Cell class="text-sm" title={task.finishedAt ?? ''}>
									{relative(task.finishedAt)}
								</Table.Cell>
							</Table.Row>
							{#if task.error}
								<Table.Row id={`task-error-${task.uid}`} class="hidden">
									<Table.Cell colspan={7} class="p-0">
										<pre
											class="bg-muted max-w-full text-wrap rounded-md p-4 text-xs">{task.error
												.message ?? JSON.stringify(task.error, null, 2)}</pre>
									</Table.Cell>
								</Table.Row>
							{/if}
						{/each}
						{#if tasks.results.length === 0}
							<Table.Row>
								<Table.Cell colspan={7} class="text-muted-foreground text-center">
									{$t('app.index_admin.no_tasks')}
								</Table.Cell>
							</Table.Row>
						{/if}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
		<Card.Footer class="flex items-center justify-between gap-4">
			<div class="text-muted-foreground text-sm">
				{$t('app.index_admin.total')}: {tasks.total.toLocaleString()}
			</div>
			<div class="flex gap-2">
				<Button variant="outline" size="sm" onclick={pageLatest} disabled={!data.filters.from}>
					{$t('app.index_admin.latest')}
				</Button>
				<Button variant="outline" size="sm" onclick={pageOlder} disabled={tasks.next == null}>
					{$t('app.index_admin.older')}
					<ChevronRight class="ml-1 h-4 w-4" />
				</Button>
			</div>
		</Card.Footer>
	</Card.Root>
</div>
