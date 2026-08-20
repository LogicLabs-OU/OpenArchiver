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
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Dialog from '$lib/components/ui/dialog';
	import { api } from '$lib/api.client';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import type { ICleanupOrphansResponse, SearchTaskStatus } from '@open-archiver/types';
	import { t } from '$lib/translations';

	let { data }: { data: PageData } = $props();
	let overview = $derived(data.overview);
	let tasks = $derived(data.tasks);
	let selectedStatus = $derived(data.filters.status);

	let isCleanupDialogOpen = $state(false);
	let isCleaning = $state(false);

	// Documents the index holds beyond the emails the database still has. Shown so the operator
	// sees the size of the problem before agreeing to it, though it understates: emails archived
	// but not yet indexed offset orphans one for one.
	let surplusDocuments = $derived(
		Math.max(0, (overview.index?.numberOfDocuments ?? 0) - overview.archivedCount)
	);

	// '' means "All".
	const statusFilters: ('' | SearchTaskStatus)[] = [
		'',
		'succeeded',
		'processing',
		'enqueued',
		'failed',
		'canceled',
	];

	const confirmCleanup = async () => {
		isCleaning = true;
		let body: Partial<ICleanupOrphansResponse>;

		try {
			const res = await api('/index-admin/orphans/cleanup', { method: 'POST' });
			// Parsed defensively: a proxy answering with an HTML error body makes res.json() reject,
			// and an unhandled rejection here would close the dialog with nothing said at all.
			body = await res.json().catch(() => ({}));

			if (!res.ok) {
				setAlert({
					type: 'error',
					title: $t('app.index_admin.cleanup_failed'),
					message: (body as { message?: string }).message ?? `HTTP ${res.status}`,
					duration: 5000,
					show: true,
				});
				return;
			}
		} catch (error) {
			setAlert({
				type: 'error',
				title: $t('app.index_admin.cleanup_failed'),
				message: error instanceof Error ? error.message : String(error),
				duration: 5000,
				show: true,
			});
			return;
		} finally {
			isCleaning = false;
			isCleanupDialogOpen = false;
		}

		if (body.alreadyRunning) {
			setAlert({
				type: 'warning',
				title: $t('app.index_admin.cleanup_already_running_title'),
				message: $t('app.index_admin.cleanup_already_running'),
				duration: 8000,
				show: true,
			});
		} else if (body.workerAlive === false) {
			setAlert({
				type: 'warning',
				title: $t('app.index_admin.cleanup_no_worker_title'),
				message: $t('app.index_admin.cleanup_no_worker'),
				duration: 10000,
				show: true,
			});
		} else {
			setAlert({
				type: 'success',
				title: $t('app.index_admin.cleanup_started'),
				message: $t('app.index_admin.cleanup_started_message'),
				duration: 8000,
				show: true,
			});
		}

		// The sweep runs in the background, so this only refreshes the counts as they stand now;
		// the operator reloads again to watch the document count fall.
		const url = new URL(window.location.href);
		goto(url.toString(), { invalidateAll: true });
	};

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
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold">{$t('app.index_admin.title')}</h1>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline">
						<Database class="mr-2 h-4 w-4" />
						{$t('app.index_admin.manage_index')}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content>
				<DropdownMenu.Label>{$t('app.index_admin.actions')}</DropdownMenu.Label>
				<DropdownMenu.Item
					class="text-red-600"
					onclick={() => (isCleanupDialogOpen = true)}
				>
					{$t('app.index_admin.cleanup_orphans')}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

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
				<Card.Title class="text-sm font-medium"
					>{$t('app.index_admin.database_size')}</Card.Title
				>
				<HardDrive class="text-muted-foreground h-4 w-4" />
			</Card.Header>
			<Card.Content>
				<div class="text-primary text-2xl font-bold">
					{formatBytes(overview.databaseSize)}
				</div>
				<p class="text-muted-foreground mt-1 text-xs">
					{$t('app.index_admin.used')}: {formatBytes(overview.usedDatabaseSize)}
				</p>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium"
					>{$t('app.index_admin.last_update')}</Card.Title
				>
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
						<p class="text-muted-foreground text-xs">
							{$t('app.index_admin.documents')}
						</p>
						<p class="text-primary text-2xl font-bold">
							{overview.index.numberOfDocuments.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-muted-foreground text-xs">
							{$t('app.index_admin.primary_key')}
						</p>
						<p class="font-mono text-sm">{overview.index.primaryKey ?? '—'}</p>
					</div>
					<div>
						<p class="text-muted-foreground text-xs">
							{$t('app.index_admin.indexing')}
						</p>
						<Badge variant={overview.index.isIndexing ? 'secondary' : 'outline'}>
							{overview.index.isIndexing
								? $t('app.index_admin.yes')
								: $t('app.index_admin.no')}
						</Badge>
					</div>
					<div>
						<p class="text-muted-foreground text-xs">
							{$t('app.index_admin.updated_at')}
						</p>
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
								<Table.Head class="text-right"
									>{$t('app.index_admin.documents')}</Table.Head
								>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each overview.documentsBySource as row (row.ingestionSourceId)}
								<Table.Row>
									<Table.Cell>
										{#if row.name}
											<a
												class="link"
												href="/dashboard/ingestions/{row.ingestionSourceId}"
												>{row.name}</a
											>
										{:else}
											<span class="text-muted-foreground font-mono text-xs"
												>{row.ingestionSourceId}
												<span class="italic"
													>({$t('app.index_admin.deleted_source')})</span
												></span
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
							<Table.Head class="text-right"
								>{$t('app.index_admin.documents')}</Table.Head
							>
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
												const el = document.getElementById(
													`task-error-${task.uid}`
												);
												if (el) el.classList.toggle('hidden');
											}}
										>
											{task.status}
										</Button>
									{:else}
										<Badge
											variant={statusVariant(task.status)}
											class="capitalize"
										>
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
								<Table.Cell class="font-mono text-sm"
									>{task.duration ?? '—'}</Table.Cell
								>
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
											class="bg-muted max-w-full text-wrap rounded-md p-4 text-xs">{task
												.error.message ??
												JSON.stringify(task.error, null, 2)}</pre>
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
				<Button
					variant="outline"
					size="sm"
					onclick={pageLatest}
					disabled={!data.filters.from}
				>
					{$t('app.index_admin.latest')}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={pageOlder}
					disabled={tasks.next == null}
				>
					{$t('app.index_admin.older')}
					<ChevronRight class="ml-1 h-4 w-4" />
				</Button>
			</div>
		</Card.Footer>
	</Card.Root>
</div>

<!-- Orphan cleanup confirmation. The wording leads with what is NOT touched, because the action
     reads as data deletion and the reassurance is the part an operator needs before agreeing. -->
<Dialog.Root bind:open={isCleanupDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{$t('app.index_admin.cleanup_confirmation_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.index_admin.cleanup_confirmation_description')}
			</Dialog.Description>
		</Dialog.Header>
		<ul class="text-muted-foreground my-2 ml-4 list-disc space-y-1 text-sm">
			<li>{$t('app.index_admin.cleanup_warning_safe')}</li>
			<li>{$t('app.index_admin.cleanup_warning_rebuild')}</li>
			<li>{$t('app.index_admin.cleanup_warning_background')}</li>
		</ul>
		<div class="bg-muted/50 rounded-md border p-3 text-sm">
			<div class="flex items-center justify-between">
				<span class="text-muted-foreground">{$t('app.index_admin.documents')}</span>
				<span class="font-mono"
					>{(overview.index?.numberOfDocuments ?? 0).toLocaleString()}</span
				>
			</div>
			<div class="flex items-center justify-between">
				<span class="text-muted-foreground">{$t('app.index_admin.archived_emails')}</span>
				<span class="font-mono">{overview.archivedCount.toLocaleString()}</span>
			</div>
			{#if surplusDocuments > 0}
				<div class="mt-2 flex items-center justify-between border-t pt-2">
					<span class="text-muted-foreground"
						>{$t('app.index_admin.estimated_orphans')}</span
					>
					<span class="font-mono font-semibold text-red-600"
						>{surplusDocuments.toLocaleString()}</span
					>
				</div>
			{/if}
		</div>
		<Dialog.Footer class="sm:justify-start">
			<Button
				type="button"
				variant="destructive"
				onclick={confirmCleanup}
				disabled={isCleaning}
			>
				{#if isCleaning}
					{$t('app.index_admin.cleaning')}...
				{:else}
					{$t('app.index_admin.cleanup_confirm')}
				{/if}
			</Button>
			<Dialog.Close>
				<Button type="button" variant="secondary">{$t('app.index_admin.cancel')}</Button>
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
