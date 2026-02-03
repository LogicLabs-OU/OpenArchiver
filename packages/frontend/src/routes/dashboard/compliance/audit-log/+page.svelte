<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { t } from '$lib/translations';
	import { Badge } from '$lib/components/ui/badge';
	import { ArrowUpDown } from 'lucide-svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api.client';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import * as HoverCard from '$lib/components/ui/hover-card/index.js';
	import type { AuditLogAction, AuditLogEntry } from '@open-archiver/types';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Label } from '$lib/components/ui/label';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';

	let { data }: { data: PageData } = $props();

	let logs = $derived(data.logs);
	let meta = $derived(data.meta);

	let isDetailViewOpen = $state(false);
	let selectedLog = $state<AuditLogEntry | null>(null);

	function viewLogDetails(log: AuditLogEntry) {
		selectedLog = log;
		isDetailViewOpen = true;
	}

	let sort = $state($page.url.searchParams.get('sort') ?? 'desc');

	function getActionBadgeClasses(action: AuditLogAction): string {
		switch (action) {
			case 'LOGIN':
				return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
			case 'CREATE':
				return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
			case 'UPDATE':
				return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
			case 'DELETE':
				return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
			case 'SEARCH':
				return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
			case 'DOWNLOAD':
				return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300';
			default:
				return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
		}
	}

	function handleSort() {
		sort = sort === 'desc' ? 'asc' : 'desc';
		const newUrl = new URL($page.url);
		newUrl.searchParams.set('sort', sort);
		goto(newUrl);
	}

	async function handleVerify() {
		try {
			const res = await api('/enterprise/audit-logs/verify', { method: 'POST' });
			const body = await res.json();

			if (res.ok) {
				setAlert({
					type: 'success',
					title: $t('app.audit_log.verification_successful_title'),
					message: body.message || $t('app.audit_log.verification_successful_message'),
					duration: 5000,
					show: true,
				});
			} else {
				setAlert({
					type: 'error',
					title: $t('app.audit_log.verification_failed_title'),
					message: body.message || $t('app.audit_log.verification_failed_message'),
					duration: 5000,
					show: true,
				});
			}
		} catch (e) {
			setAlert({
				type: 'error',
				title: $t('app.audit_log.verification_failed_title'),
				message: $t('app.audit_log.verification_error_message'),
				duration: 5000,
				show: true,
			});
		}
	}
</script>

<svelte:head>
	<title>{$t('app.audit_log.title')} - OpenArchiver</title>
</svelte:head>

<div class="mb-4 flex items-center justify-between">
	<h1 class="text-2xl font-bold">{$t('app.audit_log.header')}</h1>
	<Button onclick={handleVerify}>{$t('app.audit_log.verify_integrity')}</Button>
</div>

<div class="rounded-md border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>
					<span class="flex flex-row items-center space-x-1">
						<span>
							{$t('app.audit_log.timestamp')}
						</span>
						<Button variant="ghost" onclick={handleSort} class="h-4 w-4 p-3">
							<ArrowUpDown class=" h-3 w-3" />
						</Button>
					</span>
				</Table.Head>
				<Table.Head>{$t('app.audit_log.actor')}</Table.Head>
				<Table.Head>{$t('app.audit_log.ip_address')}</Table.Head>
				<Table.Head>{$t('app.audit_log.action')}</Table.Head>
				<Table.Head>{$t('app.audit_log.target_type')}</Table.Head>
				<Table.Head>{$t('app.audit_log.target_id')}</Table.Head>
				<Table.Head>{$t('app.audit_log.details')}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if logs && logs.length > 0}
				{#each logs as log (log.id)}
					<Table.Row class="cursor-pointer" onclick={() => viewLogDetails(log)}>
						<Table.Cell>{new Date(log.timestamp).toLocaleString()}</Table.Cell>
						<Table.Cell>
							<span class="font-mono text-xs">{log.actorIdentifier}</span>
						</Table.Cell>
						<Table.Cell>
							<span class="font-mono text-xs">{log.actorIp}</span>
						</Table.Cell>
						<Table.Cell>
							<Badge class={getActionBadgeClasses(log.actionType)}
								>{log.actionType}</Badge
							>
						</Table.Cell>
						<Table.Cell>
							{#if log.targetType}
								<Badge variant="secondary">{log.targetType}</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{#if log.targetId}
								<span class="font-mono text-xs">{log.targetId}</span>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{#if log.details}
								<HoverCard.Root>
									<HoverCard.Trigger>
										<span class="cursor-pointer font-mono text-xs">
											{JSON.stringify(log.details).length > 10
												? `${JSON.stringify(log.details).substring(0, 10)}...`
												: JSON.stringify(log.details)}
										</span>
									</HoverCard.Trigger>
									<HoverCard.Content>
										<pre
											class="max-h-64 overflow-y-auto text-xs">{JSON.stringify(
												log.details,
												null,
												2
											)}</pre>
									</HoverCard.Content>
								</HoverCard.Root>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			{:else}
				<Table.Row>
					<Table.Cell colspan={5} class="h-24 text-center">
						{$t('app.audit_log.no_logs_found')}
					</Table.Cell>
				</Table.Row>
			{/if}
		</Table.Body>
	</Table.Root>
</div>

{#if meta.total > meta.limit}
	<div class="mt-8">
		<Pagination.Root count={meta.total} perPage={meta.limit} page={meta.page}>
			{#snippet children({ pages, currentPage })}
				<Pagination.Content>
					<Pagination.Item>
						<a
							href={`/dashboard/compliance/audit-log?page=${
								currentPage - 1
							}&limit=${meta.limit}`}
						>
							<Pagination.PrevButton>
								<ChevronLeft class="h-4 w-4" />
								<span class="hidden sm:block">{$t('app.audit_log.prev')}</span>
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
									href={`/dashboard/compliance/audit-log?page=${page.value}&limit=${meta.limit}`}
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
							href={`/dashboard/compliance/audit-log?page=${
								currentPage + 1
							}&limit=${meta.limit}`}
						>
							<Pagination.NextButton>
								<span class="hidden sm:block">{$t('app.audit_log.next')}</span>
								<ChevronRight class="h-4 w-4" />
							</Pagination.NextButton>
						</a>
					</Pagination.Item>
				</Pagination.Content>
			{/snippet}
		</Pagination.Root>
	</div>
{/if}

<Dialog.Root bind:open={isDetailViewOpen}>
	<Dialog.Content class="sm:max-w-[625px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.audit_log.log_entry_details')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.audit_log.viewing_details_for')}{selectedLog?.id}.
			</Dialog.Description>
		</Dialog.Header>
		{#if selectedLog}
			<div class="grid gap-4 py-4">
				<div class="grid grid-cols-4 items-center gap-4">
					<Label class="text-right">{$t('app.audit_log.timestamp')}</Label>
					<span class="col-span-3 font-mono text-sm"
						>{new Date(selectedLog.timestamp).toLocaleString()}</span
					>
				</div>
				<div class="grid grid-cols-4 items-center gap-4">
					<Label class="text-right">{$t('app.audit_log.actor_id')}</Label>
					<span class="col-span-3 font-mono text-sm">{selectedLog.actorIdentifier}</span>
				</div>
				<div class="grid grid-cols-4 items-center gap-4">
					<Label class="text-right">{$t('app.audit_log.ip_address')}</Label>
					<span class="col-span-3 font-mono text-sm">{selectedLog.actorIp}</span>
				</div>
				<div class="grid grid-cols-4 items-center gap-4">
					<Label class="text-right">{$t('app.audit_log.action')}</Label>
					<div class="col-span-3">
						<Badge class={getActionBadgeClasses(selectedLog.actionType)}
							>{selectedLog.actionType}</Badge
						>
					</div>
				</div>
				<div class="grid grid-cols-4 items-center gap-4">
					<Label class="text-right">{$t('app.audit_log.target_type')}</Label>
					<div class="col-span-3">
						{#if selectedLog.targetType}
							<Badge variant="secondary">{selectedLog.targetType}</Badge>
						{/if}
					</div>
				</div>
				<div class="grid grid-cols-4 items-center gap-4">
					<Label class="text-right">{$t('app.audit_log.target_id')}</Label>
					<span class="col-span-3 font-mono text-sm">{selectedLog.targetId}</span>
				</div>
				<div class="grid grid-cols-4 items-start gap-4">
					<Label class="text-right">{$t('app.audit_log.details')}</Label>
					<div class="col-span-3">
						<pre
							class="max-h-64 overflow-y-auto rounded-md bg-slate-100 p-2 text-xs dark:bg-slate-800">{JSON.stringify(
								selectedLog.details,
								null,
								2
							)}</pre>
					</div>
				</div>
				<div class="grid grid-cols-4 items-start gap-4">
					<Label class="text-right">{$t('app.audit_log.previous_hash')}</Label>
					<span class="col-span-3 break-all font-mono text-sm"
						>{selectedLog.previousHash}</span
					>
				</div>
				<div class="grid grid-cols-4 items-start gap-4">
					<Label class="text-right">{$t('app.audit_log.current_hash')}</Label>
					<span class="col-span-3 break-all font-mono text-sm"
						>{selectedLog.currentHash}</span
					>
				</div>
			</div>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (isDetailViewOpen = false)}
				>{$t('app.audit_log.close')}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
