<script lang="ts">
	import type { PageData } from './$types';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import { Progress } from '$lib/components/ui/progress';
	import { formatBytes } from '$lib/utils';
	import IngestionHistoryChart from '$lib/components/custom/charts/IngestionHistoryChart.svelte';
	import {
		ArrowLeft,
		Mail,
		Users,
		HardDrive,
		Paperclip,
		MessagesSquare,
		Calendar,
		Archive,
		Lock,
		Database,
	} from 'lucide-svelte';
	import { t } from '$lib/translations';

	let { data }: { data: PageData } = $props();
	let stats = $derived(data.stats);

	const fmtDate = (d: string | null) =>
		d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

	// Index coverage percentage, clamped to 100 (Meilisearch count can momentarily
	// exceed the DB count).
	let coverage = $derived(
		stats.totalEmails > 0 ? Math.min(100, Math.round((stats.indexedCount / stats.totalEmails) * 100)) : 0
	);

	let activityData = $derived(
		stats.recentActivity.map((a) => ({ date: new Date(a.date), count: a.count }))
	);
</script>

<svelte:head>
	<title>{stats?.name ?? ''} · {$t('app.ingestions.stats_title')} - OpenArchiver</title>
</svelte:head>

{#if stats}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="space-y-1">
				<a
					href="/dashboard/ingestions"
					class="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
				>
					<ArrowLeft class="h-4 w-4" />
					{$t('app.ingestions.back_to_sources')}
				</a>
				<div class="flex items-center gap-3">
					<h1 class="text-2xl font-bold">{stats.name}</h1>
					<Badge class="capitalize">{stats.status.split('_').join(' ')}</Badge>
				</div>
				<p class="text-muted-foreground text-sm capitalize">
					{stats.provider.split('_').join(' ')}
				</p>
			</div>
			<Button
				variant="outline"
				href="/dashboard/archived-emails?ingestionSourceId={stats.sourceId}"
			>
				<Mail class="mr-2 h-4 w-4" />
				{$t('app.ingestions.view_emails')}
			</Button>
		</div>

		<!-- Summary stat cards -->
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">{$t('app.ingestions.total_emails')}</Card.Title>
					<Mail class="text-muted-foreground h-4 w-4" />
				</Card.Header>
				<Card.Content>
					<div class="text-primary text-2xl font-bold">{stats.totalEmails.toLocaleString()}</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">{$t('app.ingestions.mailboxes')}</Card.Title>
					<Users class="text-muted-foreground h-4 w-4" />
				</Card.Header>
				<Card.Content>
					<div class="text-primary text-2xl font-bold">{stats.mailboxCount.toLocaleString()}</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">{$t('app.ingestions.storage_used')}</Card.Title>
					<HardDrive class="text-muted-foreground h-4 w-4" />
				</Card.Header>
				<Card.Content>
					<div class="text-primary text-2xl font-bold">{formatBytes(stats.totalBytes)}</div>
					<p class="text-muted-foreground mt-1 text-xs">
						{$t('app.ingestions.email_storage')}: {formatBytes(stats.emailBytes)} ·
						{$t('app.ingestions.attachment_storage')}: {formatBytes(stats.attachmentBytes)}
					</p>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">{$t('app.ingestions.attachments')}</Card.Title>
					<Paperclip class="text-muted-foreground h-4 w-4" />
				</Card.Header>
				<Card.Content>
					<div class="text-primary text-2xl font-bold">{stats.attachmentCount.toLocaleString()}</div>
					<p class="text-muted-foreground mt-1 text-xs">
						{stats.emailsWithAttachments.toLocaleString()}
						{$t('app.ingestions.emails_with_attachments')}
					</p>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">{$t('app.ingestions.threads')}</Card.Title>
					<MessagesSquare class="text-muted-foreground h-4 w-4" />
				</Card.Header>
				<Card.Content>
					<div class="text-primary text-2xl font-bold">{stats.threadCount.toLocaleString()}</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">{$t('app.ingestions.date_range')}</Card.Title>
					<Calendar class="text-muted-foreground h-4 w-4" />
				</Card.Header>
				<Card.Content>
					<div class="text-primary text-lg font-bold">
						{fmtDate(stats.firstEmailAt)} – {fmtDate(stats.lastEmailAt)}
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium">{$t('app.ingestions.journaled')}</Card.Title>
					<Archive class="text-muted-foreground h-4 w-4" />
				</Card.Header>
				<Card.Content>
					<div class="text-primary text-2xl font-bold">{stats.journaledCount.toLocaleString()}</div>
				</Card.Content>
			</Card.Root>

			<!-- Legal hold is an enterprise-only feature — hidden in OSS mode. -->
			{#if data.enterpriseMode}
				<Card.Root>
					<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
						<Card.Title class="text-sm font-medium">{$t('app.ingestions.legal_hold')}</Card.Title>
						<Lock class="text-muted-foreground h-4 w-4" />
					</Card.Header>
					<Card.Content>
						<div class="text-primary text-2xl font-bold">
							{stats.legalHoldCount.toLocaleString()}
						</div>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>

		<!-- Index coverage -->
		<Card.Root>
			<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
				<Card.Title class="text-sm font-medium">{$t('app.ingestions.indexed_coverage')}</Card.Title>
				<Database class="text-muted-foreground h-4 w-4" />
			</Card.Header>
			<Card.Content class="space-y-2">
				<div class="flex items-baseline justify-between">
					<span class="text-primary text-2xl font-bold">{coverage}%</span>
					<span class="text-muted-foreground text-sm">
						{$t('app.ingestions.index_health_summary', {
							indexed: stats.indexedCount,
							total: stats.totalEmails
						} as any)}
					</span>
				</div>
				<Progress value={coverage} max={100} />
			</Card.Content>
		</Card.Root>

		<!-- Recent activity -->
		{#if activityData.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>{$t('app.ingestions.recent_activity')}</Card.Title>
				</Card.Header>
				<Card.Content>
					<IngestionHistoryChart data={activityData} />
				</Card.Content>
			</Card.Root>
		{/if}

		<!-- Per-mailbox breakdown -->
		{#if stats.mailboxes.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>{$t('app.ingestions.per_mailbox')}</Card.Title>
					<p class="text-muted-foreground text-xs">
						{$t('app.ingestions.per_mailbox_note')}
					</p>
				</Card.Header>
				<Card.Content>
					<div class="rounded-md border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>{$t('app.ingestions.mailbox')}</Table.Head>
									<Table.Head class="text-right">{$t('app.ingestions.total_emails')}</Table.Head>
									<Table.Head class="text-right">{$t('app.ingestions.storage_used')}</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each stats.mailboxes as mailbox (mailbox.userEmail)}
									<Table.Row>
										<Table.Cell class="font-mono text-sm">{mailbox.userEmail}</Table.Cell>
										<Table.Cell class="text-right">{mailbox.emailCount.toLocaleString()}</Table.Cell>
										<Table.Cell class="text-right">{formatBytes(mailbox.bytes)}</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}

		<!-- Merge-group children -->
		{#if stats.children.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>{$t('app.ingestions.merged_children')}</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-2">
					{#each stats.children as child (child.id)}
						<a
							href="/dashboard/ingestions/{child.id}"
							class="hover:bg-muted flex items-center justify-between rounded-md border p-3"
						>
							<span class="font-medium">{child.name}</span>
							<span class="text-muted-foreground text-sm capitalize"
								>{child.provider.split('_').join(' ')} · {child.status.split('_').join(' ')}</span
							>
						</a>
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
{:else}
	<p class="text-muted-foreground">{$t('app.ingestions.stats_not_found')}</p>
{/if}
