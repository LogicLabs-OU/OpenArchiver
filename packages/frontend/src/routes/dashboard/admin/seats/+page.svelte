<script lang="ts">
	import { api } from '$lib/api.client';
	import { t } from '$lib/translations';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import SeatDomainGroupsEditor from '$lib/components/custom/SeatDomainGroupsEditor.svelte';
	import { format } from 'date-fns';
	import {
		AlertTriangle,
		ChevronLeft,
		ChevronRight,
		Info,
		MoreHorizontal,
		RefreshCw,
		Link2,
		Link2Off,
	} from 'lucide-svelte';
	import type { OrganizationDomainGroup } from '@open-archiver/types';
	import type { PageData } from './$types';
	import type { SeatMailboxRow } from './types';

	let { data }: { data: PageData } = $props();

	let isReconciling = $state(false);
	let isSavingPolicy = $state(false);

	// Search and the kind filter are part of the URL, so the server pages the whole registry
	// rather than this page filtering the rows it happened to load.
	let search = $state(page.url.searchParams.get('search') ?? '');
	let kindFilter = $state(page.url.searchParams.get('kind') ?? '');

	// The policy form is seeded once from the loaded policy and then owned by the user: a
	// classification elsewhere on the page reloads the data, and must not discard unsaved edits.
	let domainGroups = $state<OrganizationDomainGroup[]>(
		data.policy.organizationDomainGroups.map((g) => ({ main: g.main, aliases: [...g.aliases] }))
	);
	let domainGroupErrors = $state<Record<number, string>>({});
	let additionalRoles = $state((data.policy.additionalRoleLocalParts ?? []).join(', '));

	let linkDialogOpen = $state(false);
	let linkSource = $state<SeatMailboxRow | null>(null);
	let linkTargetAddress = $state('');

	const report = $derived(data.report);
	const rows = $derived(data.mailboxes.mailboxes);
	const meta = $derived(data.mailboxes);
	const totalPages = $derived(Math.max(1, Math.ceil(meta.total / meta.pageSize)));

	function kindVariant(row: SeatMailboxRow): 'default' | 'secondary' | 'outline' {
		if (row.isSentinel) return 'outline';
		return row.kind === 'user' || row.kind === 'unknown' ? 'default' : 'secondary';
	}

	/** Whether "mark as shared" could change anything: not where the directory has answered. */
	function canDeclareShared(row: SeatMailboxRow): boolean {
		return !row.providerKind && row.licensed !== true;
	}

	function pageHref(target: number): string {
		const url = new URL(page.url);
		url.searchParams.set('page', String(Math.min(Math.max(target, 1), totalPages)));
		return `${url.pathname}${url.search}`;
	}

	function applyFilters() {
		const url = new URL(page.url);
		const needle = search.trim();
		if (needle) url.searchParams.set('search', needle);
		else url.searchParams.delete('search');
		if (kindFilter) url.searchParams.set('kind', kindFilter);
		else url.searchParams.delete('kind');
		url.searchParams.delete('page');
		goto(url, { keepFocus: true });
	}

	async function send(path: string, method: string, body?: unknown): Promise<boolean> {
		const res = await api(path, {
			method,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			setAlert({
				type: 'error',
				title: $t('app.seats.action_failed'),
				message: err.message || $t('app.seats.action_failed'),
				duration: 6000,
				show: true,
			});
			return false;
		}
		await invalidateAll();
		return true;
	}

	async function reconcile() {
		isReconciling = true;
		try {
			if (await send('/seats/reconcile', 'POST')) {
				setAlert({
					type: 'success',
					title: $t('app.seats.recount_done'),
					message: $t('app.seats.recount_done_desc'),
					duration: 4000,
					show: true,
				});
			}
		} finally {
			isReconciling = false;
		}
	}

	async function classify(row: SeatMailboxRow, kind: 'shared' | 'user' | null) {
		await send(`/seats/mailboxes/${row.id}/classification`, 'PUT', { kind });
	}

	function openLinkDialog(row: SeatMailboxRow) {
		linkSource = row;
		linkTargetAddress = '';
		linkDialogOpen = true;
	}

	async function confirmLink() {
		if (!linkSource) return;
		const targetAddress = linkTargetAddress.trim().toLowerCase();
		if (!targetAddress) return;
		// Resolved by address on the server, so the other mailbox need not be on this page.
		if (
			await send(`/seats/mailboxes/${linkSource.id}/identity-link`, 'PUT', {
				targetAddress,
			})
		) {
			linkDialogOpen = false;
		}
	}

	async function unlink(row: SeatMailboxRow) {
		await send(`/seats/mailboxes/${row.id}/identity-link`, 'PUT', {
			targetMailboxId: null,
		});
	}

	/**
	 * Every row must name a primary domain and at least one alias. A group without an alias
	 * merges nothing, so saving it would only look like configuration; the server refuses it too,
	 * but the message belongs under the row it concerns.
	 */
	function validateDomainGroups(): boolean {
		const errors: Record<number, string> = {};
		domainGroups.forEach((group, idx) => {
			if (!group.main.trim()) {
				errors[idx] = $t('app.seats.primary_required');
			} else if (group.aliases.filter((alias) => alias.trim()).length === 0) {
				errors[idx] = $t('app.seats.aliases_required');
			}
		});
		domainGroupErrors = errors;
		return Object.keys(errors).length === 0;
	}

	async function savePolicy(e: SubmitEvent) {
		e.preventDefault();
		if (!validateDomainGroups()) {
			setAlert({
				type: 'error',
				title: $t('app.seats.policy_invalid'),
				message: Object.values(domainGroupErrors)[0],
				duration: 6000,
				show: true,
			});
			return;
		}
		isSavingPolicy = true;
		try {
			const ok = await send('/seats/policy', 'PUT', {
				organizationDomainGroups: domainGroups.map((g) => ({
					main: g.main.trim().toLowerCase(),
					aliases: g.aliases,
				})),
				additionalRoleLocalParts: additionalRoles
					.split(/[,\n]/)
					.map((part) => part.trim().toLowerCase())
					.filter(Boolean),
			});
			if (ok) {
				setAlert({
					type: 'success',
					title: $t('app.seats.policy_saved'),
					message: $t('app.seats.policy_saved_desc'),
					duration: 4000,
					show: true,
				});
			}
		} finally {
			isSavingPolicy = false;
		}
	}
</script>

<svelte:head>
	<title>{$t('app.seats.title')} - Open Archiver</title>
	<meta name="description" content="Review how licensed seats are counted in Open Archiver." />
</svelte:head>

<div class="space-y-6">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold">{$t('app.seats.title')}</h1>
			<p class="text-muted-foreground">{$t('app.seats.description')}</p>
		</div>
		<Button variant="outline" disabled={isReconciling} onclick={reconcile}>
			<RefreshCw class="mr-2 h-4 w-4 {isReconciling ? 'animate-spin' : ''}" />
			{$t('app.seats.recount')}
		</Button>
	</div>

	{#if !data.enterpriseMode}
		<div
			class="bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-md border p-3 text-sm"
		>
			<Info class="h-4 w-4 shrink-0" />
			<p>{$t('app.seats.oss_notice')}</p>
		</div>
	{/if}

	<!-- Summary -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{$t('app.seats.summary_title')}</Card.Title>
			<Card.Description>
				{#if report}
					{$t('app.seats.summary_description', {
						seats: report.seats,
						rawMailboxes: report.rawMailboxes,
					} as never)}
				{:else}
					{$t('app.seats.never_counted')}
				{/if}
			</Card.Description>
		</Card.Header>
		{#if report}
			<Card.Content class="space-y-4">
				<div class="flex flex-wrap gap-6">
					<div>
						<p class="text-3xl font-semibold">{report.seats}</p>
						<p class="text-muted-foreground text-sm">{$t('app.seats.billable')}</p>
					</div>
					<div>
						<p class="text-3xl font-semibold">{report.rawMailboxes}</p>
						<p class="text-muted-foreground text-sm">{$t('app.seats.mailboxes')}</p>
					</div>
				</div>
				<div class="flex flex-wrap gap-2">
					<Badge variant="secondary">
						{$t('app.seats.excluded_provider')}: {report.excluded.provider}
					</Badge>
					<Badge variant="secondary">
						{$t('app.seats.excluded_pattern')}:
						{report.excluded.patternDefault + report.excluded.patternAdmin}
					</Badge>
					<Badge variant="secondary">
						{$t('app.seats.excluded_admin')}: {report.excluded.admin}
					</Badge>
					<Badge variant="secondary">
						{$t('app.seats.excluded_sentinel')}: {report.excluded.sentinel}
					</Badge>
					<Badge variant="outline">
						{$t('app.seats.merged')}:
						{report.merged.provider +
							report.merged.aliasDomain +
							report.merged.adminLink}
					</Badge>
				</div>
				<p class="text-muted-foreground text-xs">
					{$t('app.seats.computed_at', {
						date: format(new Date(report.computedAt), 'PPpp'),
					} as never)}
					{#if data.reconciling}
						{$t('app.seats.recount_in_progress')}
					{/if}
				</p>
			</Card.Content>
		{/if}
	</Card.Root>

	<!-- Needs attention -->
	{#if report && (report.loginUserOverlap > 0 || report.patternOverridesProvider > 0 || report.departed > 0)}
		<Card.Root class="border-yellow-500">
			<Card.Header>
				<div class="flex items-center gap-3">
					<AlertTriangle class="h-5 w-5 text-yellow-500" />
					<Card.Title class="text-yellow-600">
						{$t('app.seats.attention_title')}
					</Card.Title>
				</div>
			</Card.Header>
			<Card.Content class="space-y-2 text-sm">
				{#if report.loginUserOverlap > 0}
					<p>
						{$t('app.seats.attention_login_overlap', {
							count: report.loginUserOverlap,
						} as never)}
					</p>
				{/if}
				{#if report.patternOverridesProvider > 0}
					<p>
						{$t('app.seats.attention_pattern_conflict', {
							count: report.patternOverridesProvider,
						} as never)}
					</p>
				{/if}
				{#if report.departed > 0}
					<p>{$t('app.seats.attention_departed', { count: report.departed } as never)}</p>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	<!-- Mailboxes -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{$t('app.seats.mailboxes_title')}</Card.Title>
			<Card.Description>{$t('app.seats.mailboxes_description')}</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<form
				class="flex flex-wrap gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					applyFilters();
				}}
			>
				<Input
					class="max-w-xs"
					placeholder={$t('app.seats.search_placeholder')}
					bind:value={search}
				/>
				<select
					class="border-input bg-background h-9 rounded-md border px-3 text-sm"
					bind:value={kindFilter}
					onchange={applyFilters}
				>
					<option value="">{$t('app.seats.filter_all')}</option>
					<option value="user">{$t('app.seats.kind_user')}</option>
					<option value="shared">{$t('app.seats.kind_shared')}</option>
					<option value="room">{$t('app.seats.kind_room')}</option>
					<option value="equipment">{$t('app.seats.kind_equipment')}</option>
					<option value="unknown">{$t('app.seats.kind_unknown')}</option>
				</select>
			</form>

			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{$t('app.seats.column_address')}</Table.Head>
							<Table.Head>{$t('app.seats.column_kind')}</Table.Head>
							<Table.Head>{$t('app.seats.column_evidence')}</Table.Head>
							<Table.Head>{$t('app.seats.column_identity')}</Table.Head>
							<Table.Head class="text-right">
								{$t('app.seats.column_emails')}
							</Table.Head>
							<Table.Head></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each rows as row (row.id)}
							<Table.Row>
								<Table.Cell>
									<div class="font-medium">{row.address}</div>
									{#if row.displayName}
										<div class="text-muted-foreground text-xs">
											{row.displayName}
										</div>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<Badge variant={kindVariant(row)}>
										{$t(`app.seats.kind_${row.kind}`)}
									</Badge>
									{#if !row.active}
										<Badge variant="outline" class="ml-1">
											{$t('app.seats.inactive')}
										</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground text-xs">
									{#if row.kindEvidence === 'none'}
										<span>—</span>
									{:else}
										{$t(`app.seats.evidence_${row.kindEvidence}`)}
									{/if}
								</Table.Cell>
								<Table.Cell class="text-xs">
									{#if row.identityGroupSize > 1}
										<Badge variant="outline">
											{$t('app.seats.identity_group', {
												count: row.identityGroupSize,
											} as never)}
										</Badge>
										<div class="text-muted-foreground mt-1">
											{$t(`app.seats.identity_${row.identityEvidence}`)}
										</div>
									{:else}
										<span class="text-muted-foreground">
											{$t('app.seats.identity_own')}
										</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right">{row.emailCount}</Table.Cell>
								<Table.Cell class="text-right">
									{#if !row.isSentinel}
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												{#snippet child({ props })}
													<Button
														{...props}
														variant="ghost"
														size="icon"
														class="h-8 w-8"
													>
														<MoreHorizontal class="h-4 w-4" />
													</Button>
												{/snippet}
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="end">
												{#if canDeclareShared(row)}
													<DropdownMenu.Item
														onclick={() => classify(row, 'shared')}
													>
														{$t('app.seats.mark_shared')}
													</DropdownMenu.Item>
												{/if}
												<DropdownMenu.Item
													onclick={() => classify(row, 'user')}
												>
													{$t('app.seats.mark_user')}
												</DropdownMenu.Item>
												{#if row.adminKind}
													<DropdownMenu.Item
														onclick={() => classify(row, null)}
													>
														{$t('app.seats.clear_declaration')}
													</DropdownMenu.Item>
												{/if}
												<DropdownMenu.Separator />
												{#if row.linkedToMailboxId}
													<DropdownMenu.Item onclick={() => unlink(row)}>
														<Link2Off class="mr-2 h-4 w-4" />
														{$t('app.seats.unlink')}
													</DropdownMenu.Item>
												{:else}
													<DropdownMenu.Item
														onclick={() => openLinkDialog(row)}
													>
														<Link2 class="mr-2 h-4 w-4" />
														{$t('app.seats.link')}
													</DropdownMenu.Item>
												{/if}
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
			<p class="text-muted-foreground text-xs">
				{$t('app.seats.showing', {
					shown: rows.length,
					total: meta.total,
				} as never)}
			</p>

			{#if meta.total > meta.pageSize}
				<Pagination.Root count={meta.total} perPage={meta.pageSize} page={meta.page}>
					{#snippet children({ pages, currentPage })}
						<Pagination.Content>
							<Pagination.Item>
								<a href={pageHref(currentPage - 1)}>
									<Pagination.PrevButton>
										<ChevronLeft class="h-4 w-4" />
										<span class="hidden sm:block">{$t('app.seats.prev')}</span>
									</Pagination.PrevButton>
								</a>
							</Pagination.Item>
							{#each pages as p (p.key)}
								{#if p.type === 'ellipsis'}
									<Pagination.Item>
										<Pagination.Ellipsis />
									</Pagination.Item>
								{:else}
									<Pagination.Item>
										<a href={pageHref(p.value)}>
											<Pagination.Link
												page={p}
												isActive={currentPage === p.value}
											>
												{p.value}
											</Pagination.Link>
										</a>
									</Pagination.Item>
								{/if}
							{/each}
							<Pagination.Item>
								<a href={pageHref(currentPage + 1)}>
									<Pagination.NextButton>
										<span class="hidden sm:block">{$t('app.seats.next')}</span>
										<ChevronRight class="h-4 w-4" />
									</Pagination.NextButton>
								</a>
							</Pagination.Item>
						</Pagination.Content>
					{/snippet}
				</Pagination.Root>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Policy -->
	<form onsubmit={savePolicy}>
		<Card.Root>
			<Card.Header>
				<Card.Title>{$t('app.seats.policy_title')}</Card.Title>
				<Card.Description>{$t('app.seats.policy_description')}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-6">
				<div class="space-y-2">
					<Label>{$t('app.seats.domain_groups')}</Label>
					<p class="text-muted-foreground text-sm">
						{$t('app.seats.domain_groups_desc')}
					</p>
					<SeatDomainGroupsEditor
						bind:groups={domainGroups}
						bind:errors={domainGroupErrors}
						disabled={isSavingPolicy}
					/>
				</div>

				<div class="space-y-2">
					<Label for="additionalRoles">{$t('app.seats.role_names')}</Label>
					<p class="text-muted-foreground text-sm">{$t('app.seats.role_names_desc')}</p>
					<Textarea
						id="additionalRoles"
						rows={2}
						placeholder="rota, rota2, frontdesk"
						bind:value={additionalRoles}
					/>
					<details class="text-muted-foreground text-xs">
						<summary class="cursor-pointer">
							{$t('app.seats.builtin_role_names')}
						</summary>
						<p class="mt-1 font-mono">{data.defaultRoleLocalParts.join(', ')}</p>
					</details>
				</div>
			</Card.Content>
			<Card.Footer class="flex justify-end">
				<Button type="submit" disabled={isSavingPolicy}>
					{isSavingPolicy ? $t('app.common.working') : $t('app.components.common.save')}
				</Button>
			</Card.Footer>
		</Card.Root>
	</form>
</div>

<Dialog.Root bind:open={linkDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$t('app.seats.link_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.seats.link_description', { address: linkSource?.address ?? '' } as never)}
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-2"
			onsubmit={(e) => {
				e.preventDefault();
				confirmLink();
			}}
		>
			<Label for="linkTarget">{$t('app.seats.link_target')}</Label>
			<Input id="linkTarget" bind:value={linkTargetAddress} placeholder="jane@example.com" />
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (linkDialogOpen = false)}>
				{$t('app.components.common.cancel')}
			</Button>
			<Button disabled={!linkTargetAddress.trim()} onclick={confirmLink}>
				{$t('app.seats.link_confirm')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
