<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { goto } from '$app/navigation';
	import { t } from '$lib/translations';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import { api } from '$lib/api.client';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import type { PaginatedArchivedEmails } from '@open-archiver/types';

	let { data }: { data: PageData } = $props();

	let ingestionSources = $derived(data.ingestionSources);
	let archivedEmails = $state<PaginatedArchivedEmails>(data.archivedEmails);
	let selectedIngestionSourceId = $derived(data.selectedIngestionSourceId);

	let selectedIds = $state<string[]>([]);
	let isBulkDeleteDialogOpen = $state(false);
	let isBulkDeleting = $state(false);

	// Keep archivedEmails in sync with navigation; preserve selectedIds across
	// pages but reset when the source changes.
	let previousSourceId = $state(data.selectedIngestionSourceId);
	$effect(() => {
		archivedEmails = data.archivedEmails;
		if (data.selectedIngestionSourceId !== previousSourceId) {
			selectedIds = [];
			previousSourceId = data.selectedIngestionSourceId;
		}
	});

	const allEmailIds = $derived(archivedEmails.items.map((e) => e.id));
	const allCurrentPageSelected = $derived(
		allEmailIds.length > 0 && allEmailIds.every((id) => selectedIds.includes(id))
	);
	const someCurrentPageSelected = $derived(allEmailIds.some((id) => selectedIds.includes(id)));

	const handleSourceChange = (value: string | undefined) => {
		if (value) {
			goto(`/dashboard/archived-emails?ingestionSourceId=${value}`);
		}
	};

	const confirmBulkDelete = async () => {
		isBulkDeleting = true;
		const deletedIds: string[] = [];
		try {
			for (const id of selectedIds) {
				const res = await api(`/archived-emails/${id}`, { method: 'DELETE' });
				if (!res.ok) {
					const errorBody = await res.json();
					selectedIds = selectedIds.filter((i) => !deletedIds.includes(i));
					isBulkDeleteDialogOpen = false;
					setAlert({
						type: 'error',
						title: $t('app.archived_emails_page.delete_error_title'),
						message: errorBody.message || JSON.stringify(errorBody),
						duration: 5000,
						show: true,
					});
					return;
				}
				deletedIds.push(id);
			}
			selectedIds = [];
			isBulkDeleteDialogOpen = false;
			await goto(
				`/dashboard/archived-emails${selectedIngestionSourceId ? `?ingestionSourceId=${selectedIngestionSourceId}` : ''}`,
				{ invalidateAll: true }
			);
		} finally {
			isBulkDeleting = false;
		}
	};
</script>

<svelte:head>
	<title>{$t('app.archived_emails_page.title')} - OpenArchiver</title>
</svelte:head>

<div class="mb-4 flex items-center justify-between">
	<div class="flex items-center gap-4">
		<h1 class="text-2xl font-bold">{$t('app.archived_emails_page.header')}</h1>
		{#if selectedIds.length > 0}
			<Button variant="destructive" onclick={() => (isBulkDeleteDialogOpen = true)}>
				{$t('app.archived_emails_page.delete_selected')} ({selectedIds.length})
			</Button>
		{/if}
	</div>
	{#if ingestionSources.length > 0}
		<div class="w-[250px]">
			<Select.Root
				type="single"
				onValueChange={handleSourceChange}
				value={selectedIngestionSourceId}
			>
				<Select.Trigger class="w-full">
					<span
						>{selectedIngestionSourceId
							? ingestionSources.find((s) => s.id === selectedIngestionSourceId)?.name
							: $t('app.archived_emails_page.select_ingestion_source')}</span
					>
				</Select.Trigger>
				<Select.Content>
					{#each ingestionSources as source}
						<Select.Item value={source.id}>{source.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}
</div>

<div class="rounded-md border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<!-- plain <th> to avoid shadcn stripping right padding on checkbox cells -->
				<th class="text-foreground h-10 w-12 px-2 text-left align-middle font-medium">
					<Checkbox
						onCheckedChange={(checked) => {
							if (checked) {
								selectedIds = [
									...selectedIds,
									...allEmailIds.filter((id) => !selectedIds.includes(id)),
								];
							} else {
								selectedIds = selectedIds.filter((id) => !allEmailIds.includes(id));
							}
						}}
						checked={allCurrentPageSelected
							? true
							: ((someCurrentPageSelected ? 'indeterminate' : false) as any)}
					/>
				</th>
				<Table.Head>{$t('app.archived_emails_page.date')}</Table.Head>
				<Table.Head>{$t('app.archived_emails_page.subject')}</Table.Head>
				<Table.Head>{$t('app.archived_emails_page.sender')}</Table.Head>
				<Table.Head>{$t('app.archived_emails_page.inbox')}</Table.Head>
				<Table.Head>{$t('app.archived_emails_page.path')}</Table.Head>
				<Table.Head class="text-right">{$t('app.archived_emails_page.actions')}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body class="text-sm">
			{#if archivedEmails.items.length > 0}
				{#each archivedEmails.items as email (email.id)}
					<Table.Row>
						<Table.Cell>
							<Checkbox
								checked={selectedIds.includes(email.id)}
								onCheckedChange={() => {
									if (selectedIds.includes(email.id)) {
										selectedIds = selectedIds.filter((id) => id !== email.id);
									} else {
										selectedIds = [...selectedIds, email.id];
									}
								}}
							/>
						</Table.Cell>
						<Table.Cell>{new Date(email.sentAt).toLocaleString()}</Table.Cell>

						<Table.Cell>
							<div class="max-w-100 truncate">
								<a class="link" href={`/dashboard/archived-emails/${email.id}`}>
									{email.subject}
								</a>
							</div>
						</Table.Cell>
						<Table.Cell>
							{email.senderEmail || email.senderName}
						</Table.Cell>
						<Table.Cell>{email.userEmail}</Table.Cell>
						<Table.Cell>
							{#if email.path}
								<span class="  bg-muted truncate rounded p-1.5 text-xs"
									>{email.path}
								</span>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-right">
							<a href={`/dashboard/archived-emails/${email.id}`}>
								<Button variant="outline">
									{$t('app.archived_emails_page.view')}
								</Button>
							</a>
						</Table.Cell>
					</Table.Row>
				{/each}
			{:else}
				<Table.Row>
					<Table.Cell colspan={7} class="text-center"
						>{$t('app.archived_emails_page.no_emails_found')}</Table.Cell
					>
				</Table.Row>
			{/if}
		</Table.Body>
	</Table.Root>
</div>

{#if archivedEmails.total > archivedEmails.limit}
	<div class="mt-8">
		<Pagination.Root
			count={archivedEmails.total}
			perPage={archivedEmails.limit}
			page={archivedEmails.page}
		>
			{#snippet children({ pages, currentPage })}
				<Pagination.Content>
					<Pagination.Item>
						<a
							href={`/dashboard/archived-emails?ingestionSourceId=${selectedIngestionSourceId}&page=${
								currentPage - 1
							}&limit=${archivedEmails.limit}`}
						>
							<Pagination.PrevButton>
								<ChevronLeft class="h-4 w-4" />
								<span class="hidden sm:block"
									>{$t('app.archived_emails_page.prev')}</span
								>
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
									href={`/dashboard/archived-emails?ingestionSourceId=${selectedIngestionSourceId}&page=${page.value}&limit=${archivedEmails.limit}`}
								>
									<Pagination.Link {page} isActive={currentPage === page.value}>
										{page.value}
									</Pagination.Link>
								</a>
							</Pagination.Item>
						{/if}
					{/each}
					<Pagination.Item>
						<a
							href={`/dashboard/archived-emails?ingestionSourceId=${selectedIngestionSourceId}&page=${
								currentPage + 1
							}&limit=${archivedEmails.limit}`}
						>
							<Pagination.NextButton>
								<span class="hidden sm:block"
									>{$t('app.archived_emails_page.next')}</span
								>
								<ChevronRight class="h-4 w-4" />
							</Pagination.NextButton>
						</a>
					</Pagination.Item>
				</Pagination.Content>
			{/snippet}
		</Pagination.Root>
	</div>
{/if}

<!-- Bulk delete confirmation -->
<Dialog.Root bind:open={isBulkDeleteDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>
				{$t('app.archived_emails_page.bulk_delete_confirmation_title', {
					count: selectedIds.length,
				} as any)}
			</Dialog.Title>
			<Dialog.Description>
				{$t('app.archived_emails_page.bulk_delete_confirmation_description')}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="sm:justify-start">
			<Button
				type="button"
				variant="destructive"
				onclick={confirmBulkDelete}
				disabled={isBulkDeleting}
			>
				{#if isBulkDeleting}
					{$t('app.archived_emails_page.deleting')}...
				{:else}
					{$t('app.archived_emails_page.confirm')}
				{/if}
			</Button>
			<Dialog.Close>
				<Button type="button" variant="secondary">
					{$t('app.archived_emails_page.cancel')}
				</Button>
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
