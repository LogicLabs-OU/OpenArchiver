<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import { goto } from '$app/navigation';
	import { t } from '$lib/translations';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import { formatDateTimeStore } from '$lib/stores/dateFormat.store';

	let { data }: { data: PageData } = $props();

	const ALL_SOURCES = 'all';

	let ingestionSources = $derived(data.ingestionSources);
	let archivedEmails = $derived(data.archivedEmails);
	let selectedIngestionSourceId = $derived(data.selectedIngestionSourceId);

	const selectedSourceLabel = $derived.by(() => {
		if (!selectedIngestionSourceId) return $t('app.archived_emails_page.select_ingestion_source');
		if (selectedIngestionSourceId === ALL_SOURCES)
			return $t('app.archived_emails_page.all_sources');
		return ingestionSources.find((s) => s.id === selectedIngestionSourceId)?.name;
	});

	const handleSourceChange = (value: string | undefined) => {
		if (value) {
			goto(`/dashboard/archived-emails?ingestionSourceId=${value}`);
		}
	};

	const pageHref = (pageNum: number) => {
		const params = new URLSearchParams();
		if (selectedIngestionSourceId) {
			params.set('ingestionSourceId', selectedIngestionSourceId);
		}
		params.set('page', String(pageNum));
		params.set('limit', String(archivedEmails.limit));
		return `/dashboard/archived-emails?${params.toString()}`;
	};
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
					<span>{selectedSourceLabel}</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value={ALL_SOURCES}
						>{$t('app.archived_emails_page.all_sources')}</Select.Item
					>
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
						<Table.Cell>
							{#if email.sentAt}
								{$formatDateTimeStore(email.sentAt)}
							{:else}
								<Badge variant="secondary"
									>{$t('app.archive.original_date_unknown')}</Badge
								>
							{/if}
						</Table.Cell>

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
	<div class="mt-8">
		<Pagination.Root
			count={archivedEmails.total}
			perPage={archivedEmails.limit}
			page={archivedEmails.page}
		>
			{#snippet children({ pages, currentPage })}
				<Pagination.Content>
					<Pagination.Item>
						<a href={pageHref(currentPage - 1)}>
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
								<a href={pageHref(page.value)}>
									<Pagination.Link {page} isActive={currentPage === page.value}>
										{page.value}
									</Pagination.Link>
								</a>
							</Pagination.Item>
						{/if}
					{/each}
					<Pagination.Item>
						<a href={pageHref(currentPage + 1)}>
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
