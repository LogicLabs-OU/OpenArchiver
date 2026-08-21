<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { MoreHorizontal, Trash, RefreshCw, ChevronRight, Database } from 'lucide-svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Switch } from '$lib/components/ui/switch';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import IngestionSourceForm from '$lib/components/custom/IngestionSourceForm.svelte';
	import OAuthDeviceCodeDialog from '$lib/components/custom/OAuthDeviceCodeDialog.svelte';
	import { api } from '$lib/api.client';
	import type {
		SafeIngestionSource,
		CreateIngestionSourceDto,
		IndexHealth,
		ReindexMode,
		IReindexResponse,
		OAuthAuthorizeResponse,
	} from '@open-archiver/types';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import * as HoverCard from '$lib/components/ui/hover-card/index.js';
	import { t } from '$lib/translations';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

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

	// --- OAuth mailbox authorization ---
	let deviceDialogOpen = $state(false);
	let deviceDialog = $state<{
		sourceId: string;
		userCode: string;
		verificationUri: string;
		verificationUriComplete?: string;
		expiresIn: number;
		interval: number;
	} | null>(null);

	/**
	 * Starts the authorization of an oauth_mailbox source and hands the browser over:
	 * whole-window redirect for the browser flow (the state survives server-side), or the
	 * device-code dialog with its poll loop. Serves both a just-created source and the
	 * Re-authorize action — the endpoint is the same.
	 */
	const startOAuthAuthorization = async (sourceId: string) => {
		try {
			const response = await api(`/ingestion-sources/${sourceId}/oauth/authorize`, {
				method: 'POST',
				body: JSON.stringify({}),
			});
			const body: OAuthAuthorizeResponse & { message?: string } = await response.json();
			if (!response.ok) {
				throw new Error(body?.message || $t('app.ingestions.oauth_authorize_failed'));
			}
			if (body.flow === 'auth_code') {
				window.location.href = body.authorizationUrl;
				return;
			}
			deviceDialog = {
				sourceId,
				userCode: body.userCode,
				verificationUri: body.verificationUri,
				verificationUriComplete: body.verificationUriComplete,
				expiresIn: body.expiresIn,
				interval: body.interval,
			};
			deviceDialogOpen = true;
		} catch (error) {
			setAlert({
				type: 'error',
				title: $t('app.ingestions.oauth_error_title'),
				message:
					error instanceof Error
						? error.message
						: $t('app.ingestions.oauth_authorize_failed'),
				duration: 8000,
				show: true,
			});
		}
	};

	const handleDeviceFlowComplete = async (warning?: string) => {
		deviceDialogOpen = false;
		// A refused first connection is a warning, not a failure: the mailbox is authorized
		// and syncing retries on its own, so the toast says what happened without implying
		// the setup needs redoing.
		setAlert(
			warning
				? {
						type: 'warning',
						title: $t('app.ingestions.oauth_success_title'),
						message: warning,
						duration: 10000,
						show: true,
					}
				: {
						type: 'success',
						title: $t('app.ingestions.oauth_success_title'),
						message: $t('app.ingestions.oauth_success_message'),
						duration: 5000,
						show: true,
					}
		);
		await refreshSources();
	};

	const refreshSources = async () => {
		try {
			const response = await api('/ingestion-sources');
			if (response.ok) {
				ingestionSources = await response.json();
			}
		} catch (error) {
			console.error('Failed to refresh ingestion sources', error);
		}
	};

	// The browser-flow return trip: the callback page lands here with the outcome in the
	// query string. Read once, toast, and strip the params so a reload does not re-toast.
	$effect(() => {
		const result = page.url.searchParams.get('oauth_result');
		if (!result) return;
		setAlert(
			result === 'success'
				? {
						type: 'success',
						title: $t('app.ingestions.oauth_success_title'),
						message: $t('app.ingestions.oauth_success_message'),
						duration: 5000,
						show: true,
					}
				: {
						type: 'error',
						title: $t('app.ingestions.oauth_error_title'),
						message: $t('app.ingestions.oauth_error_message'),
						duration: 8000,
						show: true,
					}
		);
		goto('/dashboard/ingestions', { replaceState: true });
	});

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

	/**
	 * Reports what a reindex actually achieved rather than that the request was accepted.
	 *
	 * A 202 only means the job reached the queue. It says nothing about whether an indexing worker
	 * exists to run it, or whether there was anything to do — and both of those have silently been
	 * false in practice, leaving a success message on screen while nothing happened.
	 */
	const runReindex = async (path: string, mode: ReindexMode, scope: 'source' | 'all') => {
		let body: Partial<IReindexResponse>;

		try {
			const res = await api(path, { method: 'POST', body: JSON.stringify({ mode }) });
			// Not res.json() straight into a variable: a proxy answering with an HTML 502 body makes
			// this reject, and an unhandled rejection inside a menu onclick closes the menu with no
			// alert at all — the user sees a click that did nothing.
			body = await res.json().catch(() => ({}));

			if (!res.ok) {
				setAlert({
					type: 'error',
					title: $t('app.ingestions.reindex_failed'),
					message: (body as { message?: string }).message ?? `HTTP ${res.status}`,
					duration: 5000,
					show: true,
				});
				return;
			}
		} catch (error) {
			setAlert({
				type: 'error',
				title: $t('app.ingestions.reindex_failed'),
				message: error instanceof Error ? error.message : String(error),
				duration: 5000,
				show: true,
			});
			return;
		}

		const count = body.pending ?? 0;

		if (body.pending === 0) {
			setAlert({
				type: 'warning',
				title: $t('app.ingestions.reindex_nothing_title'),
				message: $t(
					scope === 'all'
						? 'app.ingestions.reindex_nothing_all'
						: mode === 'full'
							? 'app.ingestions.reindex_nothing_full'
							: 'app.ingestions.reindex_nothing'
				),
				duration: 8000,
				show: true,
			});
			return;
		}

		// A warning, not an error, and reported after the count: the job IS durably queued — the
		// enqueue happens before the liveness check — so telling the user it failed would be wrong and
		// would invite a repeat click that stacks another full rebuild.
		if (body.workerAlive === false) {
			setAlert({
				type: 'warning',
				title: $t('app.ingestions.reindex_no_worker_title'),
				message: $t('app.ingestions.reindex_no_worker', { count } as any),
				duration: 10000,
				show: true,
			});
			return;
		}

		setAlert({
			type: 'success',
			title: $t('app.ingestions.reindex_success'),
			message: $t('app.ingestions.reindex_queued', { count } as any),
			duration: 5000,
			show: true,
		});
	};

	const handleReindex = (id: string, mode: ReindexMode) =>
		runReindex(`/ingestion-sources/${id}/reindex`, mode, 'source');

	const handleReindexAll = (mode: ReindexMode) =>
		runReindex('/ingestion-sources/reindex-all', mode, 'all');

	// Index-health per source, loaded lazily when the status hover card opens.
	let indexHealth = $state<Record<string, IndexHealth | 'loading' | 'error'>>({});
	const loadIndexHealth = async (id: string) => {
		const current = indexHealth[id];
		if (current && current !== 'error') return; // already loaded or loading
		indexHealth[id] = 'loading';
		try {
			const res = await api(`/ingestion-sources/${id}/index-health`);
			if (!res.ok) throw new Error('failed');
			indexHealth[id] = (await res.json()) as IndexHealth;
		} catch {
			indexHealth[id] = 'error';
		}
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
				// An OAuth mailbox is created inert (pending_auth); the authorization is
				// what brings it to life, so it starts the moment the source exists.
				if (formData.provider === 'oauth_mailbox') {
					isDialogOpen = false;
					await startOAuthAuthorization(newSource.id);
					return;
				}
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
		<div class="flex items-center gap-2">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="outline">
							<Database class="mr-2 h-4 w-4" />
							{$t('app.ingestions.reindex_all')}
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content>
					<DropdownMenu.Item onclick={() => handleReindexAll('missing')}>
						{$t('app.ingestions.reindex_missing')}
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => handleReindexAll('full')}>
						{$t('app.ingestions.reindex_full')}
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<Button onclick={openCreateDialog}>{$t('app.ingestions.create_new')}</Button>
		</div>
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
								<HoverCard.Root
									onOpenChange={(open) => open && loadIndexHealth(source.id)}
								>
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
											<p class="font-mono">
												<b>{$t('app.ingestions.index_health')}:</b>
												{#if !indexHealth[source.id] || indexHealth[source.id] === 'loading'}
													{$t('app.ingestions.index_health_loading')}
												{:else if indexHealth[source.id] === 'error'}
													{$t('app.ingestions.index_health_error')}
												{:else}
													{@const h = indexHealth[
														source.id
													] as IndexHealth}
													{$t('app.ingestions.index_health_summary', {
														indexed: h.indexedCount,
														total: h.archivedCount,
													} as any)}
												{/if}
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
										<DropdownMenu.Item
											onclick={() =>
												goto(`/dashboard/ingestions/${source.id}`)}
											>{$t('app.ingestions.view_stats')}</DropdownMenu.Item
										>
										<DropdownMenu.Item onclick={() => openEditDialog(source)}
											>{$t('app.ingestions.edit')}</DropdownMenu.Item
										>
										<DropdownMenu.Item onclick={() => handleSync(source.id)}
											>{$t('app.ingestions.force_sync')}</DropdownMenu.Item
										>
										{#if source.provider === 'oauth_mailbox'}
											<DropdownMenu.Item
												onclick={() => startOAuthAuthorization(source.id)}
												>{$t(
													'app.ingestions.reauthorize'
												)}</DropdownMenu.Item
											>
										{/if}
										<!-- Both modes, because "missing only" cannot repair the case
										     where the database believes a row is indexed and the
										     search index does not hold it. -->
										<DropdownMenu.Sub>
											<DropdownMenu.SubTrigger
												>{$t(
													'app.ingestions.reindex'
												)}</DropdownMenu.SubTrigger
											>
											<DropdownMenu.SubContent>
												<DropdownMenu.Item
													onclick={() =>
														handleReindex(source.id, 'missing')}
													>{$t(
														'app.ingestions.reindex_missing'
													)}</DropdownMenu.Item
												>
												<DropdownMenu.Item
													onclick={() => handleReindex(source.id, 'full')}
													>{$t(
														'app.ingestions.reindex_full'
													)}</DropdownMenu.Item
												>
											</DropdownMenu.SubContent>
										</DropdownMenu.Sub>
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
													onclick={() =>
														goto(`/dashboard/ingestions/${child.id}`)}
													>{$t(
														'app.ingestions.view_stats'
													)}</DropdownMenu.Item
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
												{#if child.provider === 'oauth_mailbox'}
													<DropdownMenu.Item
														onclick={() =>
															startOAuthAuthorization(child.id)}
														>{$t(
															'app.ingestions.reauthorize'
														)}</DropdownMenu.Item
													>
												{/if}
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
			oauthRedirectUri={data.oauthRedirectUri}
			onSubmit={handleFormSubmit}
		/>
	</Dialog.Content>
</Dialog.Root>

{#if deviceDialog}
	<OAuthDeviceCodeDialog
		bind:open={deviceDialogOpen}
		sourceId={deviceDialog.sourceId}
		userCode={deviceDialog.userCode}
		verificationUri={deviceDialog.verificationUri}
		verificationUriComplete={deviceDialog.verificationUriComplete}
		expiresIn={deviceDialog.expiresIn}
		interval={deviceDialog.interval}
		onComplete={handleDeviceFlowComplete}
		onRetry={() => {
			const id = deviceDialog?.sourceId;
			deviceDialogOpen = false;
			if (id) startOAuthAuthorization(id);
		}}
	/>
{/if}

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
