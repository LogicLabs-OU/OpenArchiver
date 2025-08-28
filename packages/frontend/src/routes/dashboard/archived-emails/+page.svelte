<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { goto } from '$app/navigation';
	import { t } from '$lib/translations';

	let { data }: { data: PageData } = $props();

	let ingestionSources = $derived(data.ingestionSources);
	let archivedEmails = $derived(data.archivedEmails);
	let selectedIngestionSourceId = $derived(data.selectedIngestionSourceId);

	const handleSourceChange = (value: string | undefined) => {
		if (value) {
			goto(`/dashboard/archived-emails?ingestionSourceId=${value}`);
		}
	};

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
			archivedEmails.page,
			Math.ceil(archivedEmails.total / archivedEmails.limit)
		)
	);
</script>

<svelte:head>
	<title>{$t('app.archived_emails_page.title')} - OpenArchiver</title>
</svelte:head>

<div class="mb-4 flex items-center justify-between">
	<h1 class="text-2xl font-bold">{$t('app.archived_emails_page.header')}</h1>
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
								<Button variant="outline"
									>{$t('app.archived_emails_page.view')}</Button
								>
							</a>
						</Table.Cell>
					</Table.Row>
				{/each}
			{:else}
				<Table.Row>
					<Table.Cell colspan={5} class="text-center"
						>{$t('app.archived_emails_page.no_emails_found')}</Table.Cell
					>
				</Table.Row>
			{/if}
		</Table.Body>
	</Table.Root>
</div>

{#if archivedEmails.total > archivedEmails.limit}
	<div class="mt-8 flex flex-row items-center justify-center space-x-2">
		<a
			href={`/dashboard/archived-emails?ingestionSourceId=${selectedIngestionSourceId}&page=${
				archivedEmails.page - 1
			}&limit=${archivedEmails.limit}`}
			class={archivedEmails.page === 1 ? 'pointer-events-none' : ''}
		>
			<Button variant="outline" disabled={archivedEmails.page === 1}
				>{$t('app.archived_emails_page.prev')}</Button
			>
		</a>

		{#each paginationItems as item}
			{#if typeof item === 'number'}
				<a
					href={`/dashboard/archived-emails?ingestionSourceId=${selectedIngestionSourceId}&page=${item}&limit=${archivedEmails.limit}`}
				>
					<Button variant={item === archivedEmails.page ? 'default' : 'outline'}
						>{item}</Button
					>
				</a>
			{:else}
				<span class="px-4 py-2">...</span>
			{/if}
		{/each}

		<a
			href={`/dashboard/archived-emails?ingestionSourceId=${selectedIngestionSourceId}&page=${
				archivedEmails.page + 1
			}&limit=${archivedEmails.limit}`}
			class={archivedEmails.page === Math.ceil(archivedEmails.total / archivedEmails.limit)
				? 'pointer-events-none'
				: ''}
		>
			<Button
				variant="outline"
				disabled={archivedEmails.page ===
					Math.ceil(archivedEmails.total / archivedEmails.limit)}
				>{$t('app.archived_emails_page.next')}</Button
			>
		</a>
	</div>
{/if}
