<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { MoreHorizontal, Trash, RefreshCw, ChevronRight } from 'lucide-svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Switch } from '$lib/components/ui/switch';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import IngestionSourceForm from '$lib/components/custom/IngestionSourceForm.svelte';
	import { api } from '$lib/api.client';
	import type { SafeIngestionSource, CreateIngestionSourceDto } from '@open-archiver/types';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import * as HoverCard from '$lib/components/ui/hover-card/index.js';
	import { t } from '$lib/translations';

	let { data }: { data: PageData } = $props();
	let ingestionSources = $state(data.ingestionSources as SafeIngestionSource[]);
	let isDialogOpen = $state(false);
	let isDeleteDialogOpen = $state(false);
	let selectedSource = $state<SafeIngestionSource | null>(null);
	let sourceToDelete = $state<SafeIngestionSource | null>(null);
	let isDeleting = $state(false);
	let selectedIds = $state<string[]>([]);
	let isBulkDeleteDialogOpen = $state(false);
	let isUnmergeDialogOpen = $state(false);
	let sourceToUnmerge = $state<SafeIngestionSource | null>(null);
	let isUnmerging = $state(false);
	/** Tracks which root source groups are expanded in the table */
	let expandedGroups = $state<Set<string>>(new Set());

	// Group sources: roots (mergedIntoId is null/undefined) and their children
	const rootSources = $derived(ingestionSources.filter((s) => !s.mergedIntoId));

	/** Returns children for a given root source ID */
	function getChildren(rootId: string): SafeIngestionSource[] {
		return ingestionSources.filter((s) => s.mergedIntoId === rootId);
	}

	/** Returns aggregated status for a group.
	 *  If the root is paused but children are still active, show 'active'
	 *  so the group does not appear fully paused when children are running. */
	function getGroupStatus(
		root: SafeIngestionSource,
		children: SafeIngestionSource[]
	): SafeIngestionSource['status'] {
		const all = [root, ...children];
		if (all.some((s) => s.status === 'error')) return 'error';
		if (all.some((s) => s.status === 'syncing')) return 'syncing';
		if (all.some((s) => s.status === 'importing')) return 'importing';
		if (all.every((s) => s.status === 'paused')) return 'paused';
		// Root paused but some children are active/imported — show active so the
		// group badge reflects that ingestion is still ongoing via the children.
		if (
			root.status === 'paused' &&
			children.some((s) => ['active', 'imported', 'syncing', 'importing'].includes(s.status))
		)
			return 'partially_active';
		if (all.every((s) => ['imported', 'active'].includes(s.status))) return 'active';
		return root.status;
	}

	const toggleGroup = (rootId: string) => {
		const next = new Set(expandedGroups);
		if (next.has(rootId)) {
			next.delete(rootId);
		} else {
			next.add(rootId);
		}
		expandedGroups = next;
	};

	const openCreateDialog = () => {
		selectedSource = null;
		isDialogOpen = true;
	};

	const openEditDialog = (source: SafeIngestionSource) => {
		selectedSource = source as SafeIngestionSource;
		isDialogOpen = true;
	};

	const openDeleteDialog = (source: SafeIngestionSource) => {
		sourceToDelete = source;
		isDeleteDialogOpen = true;
	};

	/** Count of children that will be deleted alongside a root source */
	const deleteChildCount = $derived(
		sourceToDelete && !sourceToDelete.mergedIntoId ? getChildren(sourceToDelete.id).length : 0
	);

	const confirmDelete = async () => {
		if (!sourceToDelete) return;
		isDeleting = true;
		try {
			const res = await api(`/ingestion-sources/${sourceToDelete.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const errorBody = await res.json();
				setAlert({
					type: 'error',
					title: 'Failed to delete ingestion',
					message: errorBody.message || JSON.stringify(errorBody),
					duration: 5000,
					show: true,
				});
				return;
			}
			// Remove the deleted source and any children from state
			const deletedId = sourceToDelete.id;
			ingestionSources = ingestionSources.filter(
				(s) => s.id !== deletedId && s.mergedIntoId !== deletedId
			);
			isDeleteDialogOpen = false;
			sourceToDelete = null;
		} finally {
			isDeleting = false;
		}
	};

	const handleSync = async (id: string) => {
		const res = await api(`/ingestion-sources/${id}/sync`, { method: 'POST' });
		if (!res.ok) {
			const errorBody = await res.json();
			setAlert({
				type: 'error',
				title: 'Failed to trigger force sync ingestion',
				message: errorBody.message || JSON.stringify(errorBody),
				duration: 5000,
				show: true,
			});
			return;
		}
		ingestionSources = ingestionSources.map((s) => {
			if (s.id === id) {
				return { ...s, status: 'syncing' as const };
			}
			return s;
		});
	};

	const handleToggle = async (source: SafeIngestionSource) => {
		try {
			const isPaused = source.status === 'paused';
			const newStatus = isPaused ? 'active' : 'paused';
			if (newStatus === 'paused') {
				const response = await api(`/ingestion-sources/${source.id}/pause`, {
					method: 'POST',
				});
				const responseText = await response.json();
				if (!response.ok) {
					throw Error(responseText.message || 'Operation failed');
				}
			} else {
				const response = await api(`/ingestion-sources/${source.id}`, {
					method: 'PUT',
					body: JSON.stringify({ status: 'active' }),
				});
				const responseText = await response.json();
				if (!response.ok) {
					throw Error(responseText.message || 'Operation failed');
				}
			}

			ingestionSources = ingestionSources.map((s) => {
				if (s.id === source.id) {
					return { ...s, status: newStatus };
				}
				return s;
			});
		} catch (e) {
			setAlert({
				type: 'error',
				title: 'Failed to trigger force sync ingestion',
				message: e instanceof Error ? e.message : JSON.stringify(e),
				duration: 5000,
				show: true,
			});
		}
	};

	const openUnmergeDialog = (source: SafeIngestionSource) => {
		sourceToUnmerge = source;
		isUnmergeDialogOpen = true;
	};

	const confirmUnmerge = async () => {
		if (!sourceToUnmerge) return;
		isUnmerging = true;
		try {
			const res = await api(`/ingestion-sources/${sourceToUnmerge.id}/unmerge`, {
				method: 'POST',
			});
			if (!res.ok) {
				const errorBody = await res.json();
				throw Error(errorBody.message || 'Unmerge failed');
			}
			const updated: SafeIngestionSource = await res.json();
			ingestionSources = ingestionSources.map((s) => (s.id === updated.id ? updated : s));
			isUnmergeDialogOpen = false;
			sourceToUnmerge = null;
			setAlert({
				type: 'success',
				title: $t('app.ingestions.unmerge_success'),
				message: '',
				duration: 3000,
				show: true,
			});
		} catch (e) {
			setAlert({
				type: 'error',
				title: 'Failed to unmerge',
				message: e instanceof Error ? e.message : JSON.stringify(e),
				duration: 5000,
				show: true,
			});
		} finally {
			isUnmerging = false;
		}
	};

	const handleBulkDelete = async () => {
		isDeleting = true;
		try {
			for (const id of selectedIds) {
				const res = await api(`/ingestion-sources/${id}`, { method: 'DELETE' });
				if (!res.ok) {
					const errorBody = await res.json();
					setAlert({
						type: 'error',
						title: `Failed to delete ingestion ${id}`,
						message: errorBody.message || JSON.stringify(errorBody),
						duration: 5000,
						show: true,
					});
					return;
				}
			}
			// Remove deleted roots and their children from local state
			// (backend cascades child deletion, so we mirror that here)
			ingestionSources = ingestionSources.filter(
				(s) => !selectedIds.includes(s.id) && !selectedIds.includes(s.mergedIntoId ?? '')
			);
			selectedIds = [];
			isBulkDeleteDialogOpen = false;
		} finally {
			isDeleting = false;
		}
	};

	const handleBulkForceSync = async () => {
		try {
			for (const id of selectedIds) {
				const res = await api(`/ingestion-sources/${id}/sync`, { method: 'POST' });
				if (!res.ok) {
					const errorBody = await res.json();
					setAlert({
						type: 'error',
						title: `Failed to trigger force sync for ingestion ${id}`,
						message: errorBody.message || JSON.stringify(errorBody),
						duration: 5000,
						show: true,
					});
				}
			}
			// Backend cascades force sync to non-file-based children,
			// so optimistically mark root + eligible children as syncing
			const fileBasedProviders = ['pst_import', 'eml_import', 'mbox_import'];
			ingestionSources = ingestionSources.map((s) => {
				// Mark selected roots as syncing
				if (selectedIds.includes(s.id)) {
					return { ...s, status: 'syncing' as const };
				}
				// Mark non-file-based children of selected roots as syncing
				if (
					s.mergedIntoId &&
					selectedIds.includes(s.mergedIntoId) &&
					!fileBasedProviders.includes(s.provider) &&
					(s.status === 'active' || s.status === 'error')
				) {
					return { ...s, status: 'syncing' as const };
				}
				return s;
			});
			selectedIds = [];
		} catch (e) {
			setAlert({
				type: 'error',
				title: 'Failed to trigger force sync',
				message: e instanceof Error ? e.message : JSON.stringify(e),
				duration: 5000,
				show: true,
			});
		}
	};

	const handleFormSubmit = async (formData: CreateIngestionSourceDto) => {
		try {
			if (selectedSource) {
				// Update
				const response = await api(`/ingestion-sources/${selectedSource.id}`, {
					method: 'PUT',
					body: JSON.stringify(formData),
				});
				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(errorData.message || 'Failed to update source.');
				}
				const updatedSource = await response.json();
				ingestionSources = ingestionSources.map((s) =>
					s.id === updatedSource.id ? updatedSource : s
				);
			} else {
				// Create
				const response = await api('/ingestion-sources', {
					method: 'POST',
					body: JSON.stringify(formData),
				});
				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(errorData.message || 'Failed to create source.');
				}
				const newSource = await response.json();
				ingestionSources = [...ingestionSources, newSource];
			}
			isDialogOpen = false;
		} catch (error) {
			let message = 'An unknown error occurred.';
			if (error instanceof Error) {
				message = error.message;
			}
			setAlert({
				type: 'error',
				title: 'Authentication Failed',
				message,
				duration: 5000,
				show: true,
			});
		}
	};

	function getStatusClasses(status: SafeIngestionSource['status']): string {
		switch (status) {
			case 'active':
				return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
			case 'partially_active':
				return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
			case 'imported':
				return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
			case 'paused':
				return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
			case 'error':
				return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
			case 'syncing':
				return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
			case 'importing':
				return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
			case 'pending_auth':
				return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
			case 'auth_success':
				return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
			default:
				return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
		}
	}
</script>

<svelte:head>
	<title>{$t('app.ingestions.title')} - OpenArchiver</title>
</svelte:head>

<div class="">
	<div class="mb-4 flex items-center justify-between">
		<div class="flex items-center gap-4">
			<h1 class="text-2xl font-bold">{$t('app.ingestions.ingestion_sources')}</h1>
			{#if selectedIds.length > 0}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline">
								{$t('app.ingestions.bulk_actions')} ({selectedIds.length})
								<MoreHorizontal class="ml-2 h-4 w-4" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content>
						<DropdownMenu.Item onclick={handleBulkForceSync}>
							<RefreshCw class="mr-2 h-4 w-4" />
							{$t('app.ingestions.force_sync')}
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="text-red-600"
							onclick={() => (isBulkDeleteDialogOpen = true)}
						>
							<Trash class="mr-2 h-4 w-4" />
							{$t('app.ingestions.delete')}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
		<Button onclick={openCreateDialog}>{$t('app.ingestions.create_new')}</Button>
	</div>

	<div class="rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-12">
						<Checkbox
							onCheckedChange={(checked) => {
								if (checked) {
									selectedIds = rootSources.map((s) => s.id);
								} else {
									selectedIds = [];
								}
							}}
							checked={rootSources.length > 0 &&
							selectedIds.length === rootSources.length
								? true
								: ((selectedIds.length > 0 ? 'indeterminate' : false) as any)}
						/>
					</Table.Head>
					<Table.Head>{$t('app.ingestions.name')}</Table.Head>
					<Table.Head>{$t('app.ingestions.provider')}</Table.Head>
					<Table.Head>{$t('app.ingestions.status')}</Table.Head>
					<Table.Head>{$t('app.ingestions.active')}</Table.Head>
					<Table.Head>{$t('app.ingestions.created_at')}</Table.Head>
					<Table.Head class="text-right">{$t('app.ingestions.actions')}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if rootSources.length > 0}
					{#each rootSources as source (source.id)}
						{@const children = getChildren(source.id)}
						{@const hasChildren = children.length > 0}
						{@const isExpanded = expandedGroups.has(source.id)}
						{@const displayStatus = hasChildren
							? getGroupStatus(source, children)
							: source.status}

						<!-- Root row -->
						<Table.Row>
							<Table.Cell>
								<Checkbox
									checked={selectedIds.includes(source.id)}
									onCheckedChange={() => {
										if (selectedIds.includes(source.id)) {
											selectedIds = selectedIds.filter(
												(id) => id !== source.id
											);
										} else {
											selectedIds = [...selectedIds, source.id];
										}
									}}
								/>
							</Table.Cell>
							<Table.Cell>
								<div class="flex items-center gap-1">
									{#if hasChildren}
										<button
											class="cursor-pointer rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
											onclick={() => toggleGroup(source.id)}
											aria-label={isExpanded
												? $t('app.ingestions.collapse')
												: $t('app.ingestions.expand')}
										>
											<ChevronRight
												class="h-4 w-4 transition-transform {isExpanded
													? 'rotate-90'
													: ''}"
											/>
										</button>
									{/if}
									<a
										class="link"
										href="/dashboard/archived-emails?ingestionSourceId={source.id}"
										>{source.name}</a
									>
									{#if hasChildren}
										<span class="text-muted-foreground ml-1 text-xs"
											>({children.length}
											{$t('app.ingestions.merged_sources')})</span
										>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell class="capitalize"
								>{source.provider.split('_').join(' ')}</Table.Cell
							>
							<Table.Cell class="min-w-24">
								<HoverCard.Root>
									<HoverCard.Trigger>
										<Badge
											class="{getStatusClasses(
												displayStatus
											)} cursor-pointer capitalize"
										>
											{displayStatus.split('_').join(' ')}
										</Badge>
									</HoverCard.Trigger>
									<HoverCard.Content class="{getStatusClasses(displayStatus)} ">
										<div class="flex flex-col space-y-4 text-sm">
											<p class=" font-mono">
												<b>{$t('app.ingestions.last_sync_message')}:</b>
												{source.lastSyncStatusMessage ||
													$t('app.ingestions.empty')}
											</p>
										</div>
									</HoverCard.Content>
								</HoverCard.Root>
							</Table.Cell>
							<Table.Cell>
								<Switch
									id={`active-switch-${source.id}`}
									class="cursor-pointer"
									checked={source.status !== 'paused'}
									onCheckedChange={() => handleToggle(source)}
								/>
							</Table.Cell>
							<Table.Cell
								>{new Date(source.createdAt).toLocaleDateString()}</Table.Cell
							>
							<Table.Cell class="text-right">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button {...props} variant="ghost" class="h-8 w-8 p-0">
												<span class="sr-only"
													>{$t('app.ingestions.open_menu')}</span
												>
												<MoreHorizontal class="h-4 w-4" />
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content>
										<DropdownMenu.Label
											>{$t('app.ingestions.actions')}</DropdownMenu.Label
										>
										<DropdownMenu.Item onclick={() => openEditDialog(source)}
											>{$t('app.ingestions.edit')}</DropdownMenu.Item
										>
										<DropdownMenu.Item onclick={() => handleSync(source.id)}
											>{$t('app.ingestions.force_sync')}</DropdownMenu.Item
										>
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											class="text-red-600"
											onclick={() => openDeleteDialog(source)}
											>{$t('app.ingestions.delete')}</DropdownMenu.Item
										>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Table.Cell>
						</Table.Row>

						<!-- Child rows (shown when group is expanded) -->
						{#if hasChildren && isExpanded}
							{#each children as child (child.id)}
								<Table.Row class="bg-muted/30">
									<Table.Cell>
										<!-- No checkbox for children -->
									</Table.Cell>
									<Table.Cell>
										<div class="flex items-center gap-1 pl-6">
											<span class="text-muted-foreground mr-1">└</span>
											<!-- Child emails are stored under the root source — link to root -->
											<a
												class="link"
												href="/dashboard/archived-emails?ingestionSourceId={child.mergedIntoId}"
												>{child.name}</a
											>
										</div>
									</Table.Cell>
									<Table.Cell class="capitalize"
										>{child.provider.split('_').join(' ')}</Table.Cell
									>
									<Table.Cell class="min-w-24">
										<HoverCard.Root>
											<HoverCard.Trigger>
												<Badge
													class="{getStatusClasses(
														child.status
													)} cursor-pointer capitalize"
												>
													{child.status.split('_').join(' ')}
												</Badge>
											</HoverCard.Trigger>
											<HoverCard.Content
												class="{getStatusClasses(child.status)} "
											>
												<div class="flex flex-col space-y-4 text-sm">
													<p class=" font-mono">
														<b
															>{$t(
																'app.ingestions.last_sync_message'
															)}:</b
														>
														{child.lastSyncStatusMessage ||
															$t('app.ingestions.empty')}
													</p>
												</div>
											</HoverCard.Content>
										</HoverCard.Root>
									</Table.Cell>
									<Table.Cell>
										<Switch
											id={`active-switch-${child.id}`}
											class="cursor-pointer"
											checked={child.status !== 'paused'}
											onCheckedChange={() => handleToggle(child)}
										/>
									</Table.Cell>
									<Table.Cell
										>{new Date(
											child.createdAt
										).toLocaleDateString()}</Table.Cell
									>
									<Table.Cell class="text-right">
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												{#snippet child({ props })}
													<Button
														{...props}
														variant="ghost"
														class="h-8 w-8 p-0"
													>
														<span class="sr-only"
															>{$t('app.ingestions.open_menu')}</span
														>
														<MoreHorizontal class="h-4 w-4" />
													</Button>
												{/snippet}
											</DropdownMenu.Trigger>
											<DropdownMenu.Content>
												<DropdownMenu.Label
													>{$t(
														'app.ingestions.actions'
													)}</DropdownMenu.Label
												>
												<DropdownMenu.Item
													onclick={() => openEditDialog(child)}
													>{$t('app.ingestions.edit')}</DropdownMenu.Item
												>
												<DropdownMenu.Item
													onclick={() => handleSync(child.id)}
													>{$t(
														'app.ingestions.force_sync'
													)}</DropdownMenu.Item
												>
												<DropdownMenu.Item
													onclick={() => openUnmergeDialog(child)}
												>
													{$t('app.ingestions.unmerge')}
												</DropdownMenu.Item>
												<DropdownMenu.Separator />
												<DropdownMenu.Item
													class="text-red-600"
													onclick={() => openDeleteDialog(child)}
													>{$t(
														'app.ingestions.delete'
													)}</DropdownMenu.Item
												>
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									</Table.Cell>
								</Table.Row>
							{/each}
						{/if}
					{/each}
				{:else}
					<Table.Row>
						<Table.Cell class="h-8 text-center"></Table.Cell>
					</Table.Row>
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<Dialog.Root bind:open={isDialogOpen}>
	<Dialog.Content
		class="sm:max-w-120 md:max-w-180"
		onInteractOutside={(e) => {
			e.preventDefault();
		}}
	>
		<Dialog.Header>
			<Dialog.Title
				>{selectedSource ? $t('app.ingestions.edit') : $t('app.ingestions.create')}{' '}
				{$t('app.ingestions.ingestion_source')}</Dialog.Title
			>
			<Dialog.Description>
				{selectedSource
					? $t('app.ingestions.edit_description')
					: $t('app.ingestions.create_description')}
				<span
					>{$t('app.ingestions.read')}{' '}
					<a
						class="text-primary underline underline-offset-2"
						target="_blank"
						href="https://docs.openarchiver.com/user-guides/email-providers/"
						>{$t('app.ingestions.docs_here')}</a
					>.</span
				>
			</Dialog.Description>
		</Dialog.Header>
		<IngestionSourceForm
			source={selectedSource}
			existingSources={ingestionSources}
			onSubmit={handleFormSubmit}
		/>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={isDeleteDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{$t('app.ingestions.delete_confirmation_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.ingestions.delete_confirmation_description')}
				{#if deleteChildCount > 0}
					<p class="mt-2 font-semibold text-red-600">
						{$t('app.ingestions.delete_root_warning', {
							count: deleteChildCount,
						} as any)}
					</p>
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="sm:justify-start">
			<Button
				type="button"
				variant="destructive"
				onclick={confirmDelete}
				disabled={isDeleting}
				>{#if isDeleting}
					{$t('app.ingestions.deleting')}...
				{:else}
					{$t('app.ingestions.confirm')}
				{/if}</Button
			>
			<Dialog.Close>
				<Button type="button" variant="secondary">{$t('app.ingestions.cancel')}</Button>
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={isBulkDeleteDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title
				>{$t('app.ingestions.bulk_delete_confirmation_title', {
					count: selectedIds.length,
				} as any)}</Dialog.Title
			>
			<Dialog.Description>
				{$t('app.ingestions.bulk_delete_confirmation_description')}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="sm:justify-start">
			<Button
				type="button"
				variant="destructive"
				onclick={handleBulkDelete}
				disabled={isDeleting}
				>{#if isDeleting}
					{$t('app.ingestions.deleting')}...
				{:else}
					{$t('app.ingestions.confirm')}
				{/if}</Button
			>
			<Dialog.Close>
				<Button type="button" variant="secondary">{$t('app.ingestions.cancel')}</Button>
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Unmerge confirmation modal -->
<Dialog.Root bind:open={isUnmergeDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{$t('app.ingestions.unmerge_confirmation_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.ingestions.unmerge_confirmation_description')}
			</Dialog.Description>
		</Dialog.Header>
		<ul class="text-muted-foreground my-2 ml-4 list-disc space-y-1 text-sm">
			<li>{$t('app.ingestions.unmerge_warning_emails')}</li>
			<li>{$t('app.ingestions.unmerge_warning_future')}</li>
		</ul>
		<Dialog.Footer class="sm:justify-start">
			<Button type="button" variant="default" onclick={confirmUnmerge} disabled={isUnmerging}>
				{#if isUnmerging}
					{$t('app.ingestions.unmerging')}...
				{:else}
					{$t('app.ingestions.unmerge_confirm')}
				{/if}
			</Button>
			<Dialog.Close>
				<Button type="button" variant="secondary">{$t('app.ingestions.cancel')}</Button>
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
