<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { t } from '$lib/translations';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { enhance } from '$app/forms';
	import { MoreHorizontal, Plus, FlaskConical } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import RetentionPolicyForm from '$lib/components/custom/RetentionPolicyForm.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { RetentionPolicy, PolicyEvaluationResult } from '@open-archiver/types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let policies = $derived(data.policies);
	let ingestionSources = $derived(data.ingestionSources);

	// --- Dialog state ---
	let isCreateOpen = $state(false);
	let isEditOpen = $state(false);
	let isDeleteOpen = $state(false);
	let selectedPolicy = $state<RetentionPolicy | null>(null);
	let isFormLoading = $state(false);
	let isDeleting = $state(false);

	// --- Simulator state ---
	let isSimulating = $state(false);
	let evaluationResult = $state<PolicyEvaluationResult | null>(null);
	/** The ingestion source ID selected for the simulator (empty string = all sources / no filter) */
	let simIngestionSourceId = $state('');

	function openEdit(policy: RetentionPolicy) {
		selectedPolicy = policy;
		isEditOpen = true;
	}

	function openDelete(policy: RetentionPolicy) {
		selectedPolicy = policy;
		isDeleteOpen = true;
	}

	// React to form results (errors and evaluation results)
	$effect(() => {
		if (form && form.success === false && form.message) {
			toast.error(form.message);
		}
		if (form && 'evaluationResult' in form) {
			evaluationResult = form.evaluationResult ?? null;
		}
	});

	/** Returns a human-readable summary of the conditions on a policy. */
	function conditionsSummary(policy: RetentionPolicy): string {
		if (!policy.conditions || policy.conditions.rules.length === 0) {
			return $t('app.retention_policies.no_conditions');
		}
		const count = policy.conditions.rules.length;
		const op = policy.conditions.logicalOperator;
		return `${count} ${$t('app.retention_policies.rules')} (${op})`;
	}

</script>

<svelte:head>
	<title>{$t('app.retention_policies.title')} - Open Archiver</title>
	<meta name="description" content={$t('app.retention_policies.meta_description')} />
	<meta
		name="keywords"
		content="retention policies, data retention, email lifecycle, compliance, GDPR"
	/>
</svelte:head>

<div class="mb-6 flex items-center justify-between">
	<h1 class="text-2xl font-bold">{$t('app.retention_policies.header')}</h1>
	<Button onclick={() => (isCreateOpen = true)}>
		<Plus class="mr-1.5 h-4 w-4" />
		{$t('app.retention_policies.create_new')}
	</Button>
</div>

<div class="rounded-md border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>{$t('app.retention_policies.name')}</Table.Head>
				<Table.Head>{$t('app.retention_policies.priority')}</Table.Head>
				<Table.Head>{$t('app.retention_policies.retention_period')}</Table.Head>
				<Table.Head>{$t('app.retention_policies.ingestion_scope')}</Table.Head>
				<Table.Head>{$t('app.retention_policies.conditions')}</Table.Head>
				<Table.Head>{$t('app.retention_policies.status')}</Table.Head>
				<Table.Head class="text-right">{$t('app.ingestions.actions')}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if policies && policies.length > 0}
				{#each policies as policy (policy.id)}
					<Table.Row>
						<Table.Cell class="font-medium">
							<div>{policy.name}</div>
							<div class="mt-0.5 font-mono text-[10px] text-muted-foreground">
								{policy.id}
							</div>
							{#if policy.description}
								<div class="text-muted-foreground mt-0.5 text-xs">{policy.description}</div>
							{/if}
						</Table.Cell>
						<Table.Cell>{policy.priority}</Table.Cell>
						<Table.Cell>
							{policy.retentionPeriodDays}
							{$t('app.retention_policies.days')}
						</Table.Cell>
						<Table.Cell>
							{#if !policy.ingestionScope || policy.ingestionScope.length === 0}
								<span class="text-muted-foreground text-sm italic">
									{$t('app.retention_policies.ingestion_scope_all')}
								</span>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each policy.ingestionScope as sourceId (sourceId)}
										{@const source = ingestionSources.find((s) => s.id === sourceId)}
										<Badge variant="outline" class="text-xs">
											{source?.name ?? sourceId.slice(0, 8) + '…'}
										</Badge>
									{/each}
								</div>
							{/if}
						</Table.Cell>
						<Table.Cell>
							<span class="text-muted-foreground text-sm">{conditionsSummary(policy)}</span>
						</Table.Cell>
						<Table.Cell>
							{#if policy.isActive}
								<Badge variant="default" class="bg-green-500 text-white">
									{$t('app.retention_policies.active')}
								</Badge>
							{:else}
								<Badge variant="secondary">
									{$t('app.retention_policies.inactive')}
								</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-right">
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon"
											class="h-8 w-8"
											aria-label={$t('app.ingestions.open_menu')}
										>
											<MoreHorizontal class="h-4 w-4" />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item onclick={() => openEdit(policy)}>
										{$t('app.retention_policies.edit')}
									</DropdownMenu.Item>
									<DropdownMenu.Item
										class="text-destructive focus:text-destructive"
										onclick={() => openDelete(policy)}
									>
										{$t('app.retention_policies.delete')}
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</Table.Cell>
					</Table.Row>
				{/each}
			{:else}
				<Table.Row>
					<Table.Cell colspan={7} class="h-24 text-center">
						{$t('app.retention_policies.no_policies_found')}
					</Table.Cell>
				</Table.Row>
			{/if}
		</Table.Body>
	</Table.Root>
</div>

<!-- Create dialog -->
<Dialog.Root bind:open={isCreateOpen}>
	<Dialog.Content class="sm:max-w-[600px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.retention_policies.create')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.retention_policies.create_description')}
			</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-[70vh] overflow-y-auto pr-1">
			<RetentionPolicyForm
				action="?/create"
				{ingestionSources}
				bind:isLoading={isFormLoading}
				onCancel={() => (isCreateOpen = false)}
				onSuccess={() => {
					isCreateOpen = false;
					toast.success($t('app.retention_policies.create_success'));
				}}
			/>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Edit dialog -->
<Dialog.Root bind:open={isEditOpen}>
	<Dialog.Content class="sm:max-w-[600px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.retention_policies.edit')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.retention_policies.edit_description')}
			</Dialog.Description>
		</Dialog.Header>
		{#if selectedPolicy}
			<div class="max-h-[70vh] overflow-y-auto pr-1">
				<RetentionPolicyForm
					policy={selectedPolicy}
					action="?/update"
					{ingestionSources}
					bind:isLoading={isFormLoading}
					onCancel={() => (isEditOpen = false)}
					onSuccess={() => {
						isEditOpen = false;
						selectedPolicy = null;
						toast.success($t('app.retention_policies.update_success'));
					}}
				/>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Policy Simulator -->
<div class="mt-8 rounded-md border">
	<div class="flex items-center gap-2 border-b px-6 py-4">
		<FlaskConical class="text-muted-foreground h-5 w-5" />
		<div>
			<h2 class="text-base font-semibold">{$t('app.retention_policies.simulator_title')}</h2>
			<p class="text-muted-foreground text-sm">
				{$t('app.retention_policies.simulator_description')}
			</p>
		</div>
	</div>

	<form
		method="POST"
		action="?/evaluate"
		class="grid gap-6 p-6 md:grid-cols-2"
		use:enhance={() => {
			isSimulating = true;
			evaluationResult = null;
			return async ({ update }) => {
				isSimulating = false;
				await update({ reset: false });
			};
		}}
	>
		<!-- Hidden field for selected ingestion source -->
		<input type="hidden" name="ingestionSourceId" value={simIngestionSourceId} />

		<!-- Sender -->
		<div class="space-y-1.5">
			<Label for="sim-sender">{$t('app.retention_policies.simulator_sender')}</Label>
			<Input
				id="sim-sender"
				name="sender"
				type="email"
				placeholder={$t('app.retention_policies.simulator_sender_placeholder')}
			/>
		</div>

		<!-- Subject -->
		<div class="space-y-1.5">
			<Label for="sim-subject">{$t('app.retention_policies.simulator_subject')}</Label>
			<Input
				id="sim-subject"
				name="subject"
				placeholder={$t('app.retention_policies.simulator_subject_placeholder')}
			/>
		</div>

		<!-- Recipients -->
		<div class="space-y-1.5">
			<Label for="sim-recipients">{$t('app.retention_policies.simulator_recipients')}</Label>
			<Input
				id="sim-recipients"
				name="recipients"
				placeholder={$t('app.retention_policies.simulator_recipients_placeholder')}
			/>
		</div>

		<!-- Attachment Types -->
		<div class="space-y-1.5">
			<Label for="sim-attachment-types">
				{$t('app.retention_policies.simulator_attachment_types')}
			</Label>
			<Input
				id="sim-attachment-types"
				name="attachmentTypes"
				placeholder={$t('app.retention_policies.simulator_attachment_types_placeholder')}
			/>
		</div>

		<!-- Ingestion Source filter (only shown when sources are available) -->
		{#if ingestionSources.length > 0}
			<div class="space-y-1.5 md:col-span-2">
				<Label>{$t('app.retention_policies.simulator_ingestion_source')}</Label>
				<p class="text-muted-foreground text-xs">
					{$t('app.retention_policies.simulator_ingestion_source_description')}
				</p>
				<Select.Root
					type="single"
					value={simIngestionSourceId}
					onValueChange={(v) => (simIngestionSourceId = v)}
				>
					<Select.Trigger class="w-full">
						{#if simIngestionSourceId}
							{ingestionSources.find((s) => s.id === simIngestionSourceId)?.name ??
								$t('app.retention_policies.simulator_ingestion_all')}
						{:else}
							{$t('app.retention_policies.simulator_ingestion_all')}
						{/if}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="">
							<span class="italic">{$t('app.retention_policies.simulator_ingestion_all')}</span>
						</Select.Item>
						{#each ingestionSources as source (source.id)}
							<Select.Item value={source.id}>
								{source.name}
								<span class="text-muted-foreground ml-1 text-xs">
									({source.provider.replace(/_/g, ' ')})
								</span>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}

		<!-- Submit spans full width on md -->
		<div class="flex items-end md:col-span-2">
			<Button type="submit" disabled={isSimulating} class="w-full md:w-auto">
				<FlaskConical class="mr-1.5 h-4 w-4" />
				{#if isSimulating}
					{$t('app.retention_policies.simulator_running')}
				{:else}
					{$t('app.retention_policies.simulator_run')}
				{/if}
			</Button>
		</div>
	</form>

	<!-- Result panel — shown only after a simulation has been run -->
	{#if evaluationResult !== null}
		<div class="border-t px-6 py-4">
			<h3 class="mb-3 text-sm font-semibold">
				{$t('app.retention_policies.simulator_result_title')}
			</h3>
			{#if evaluationResult.appliedRetentionDays === 0}
				<div class="bg-muted rounded-md p-4 text-sm">
					{$t('app.retention_policies.simulator_no_match')}
				</div>
			{:else}
				<div class="space-y-3">
					<div class="rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
						<p class="text-sm font-medium text-green-800 dark:text-green-200">
							{($t as any)('app.retention_policies.simulator_matched', {
								days: evaluationResult.appliedRetentionDays,
							})}
						</p>
					</div>
					{#if evaluationResult.matchingPolicyIds.length > 0}
						<div class="space-y-1.5">
							<p class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
								{$t('app.retention_policies.simulator_matching_policies')}
							</p>
							<div class="flex flex-wrap gap-2">
								{#each evaluationResult.matchingPolicyIds as policyId (policyId)}
									{@const matchedPolicy = policies.find((p) => p.id === policyId)}
									<div class="flex items-center gap-1.5">
										<code class="bg-muted rounded px-2 py-0.5 font-mono text-xs">
											{policyId}
										</code>
										{#if matchedPolicy}
											<span class="text-muted-foreground text-xs">({matchedPolicy.name})</span>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{:else if !isSimulating}
		<div class="border-t px-6 py-4">
			<p class="text-muted-foreground text-sm">
				{$t('app.retention_policies.simulator_no_result')}
			</p>
		</div>
	{/if}
</div>

<!-- Delete confirmation dialog -->
<Dialog.Root bind:open={isDeleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$t('app.retention_policies.delete_confirmation_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.retention_policies.delete_confirmation_description')}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => (isDeleteOpen = false)}
				disabled={isDeleting}
			>
				{$t('app.retention_policies.cancel')}
			</Button>
			{#if selectedPolicy}
				<form
					method="POST"
					action="?/delete"
					use:enhance={() => {
						isDeleting = true;
						return async ({ result, update }) => {
							isDeleting = false;
							if (result.type === 'success') {
								isDeleteOpen = false;
								selectedPolicy = null;
								toast.success($t('app.retention_policies.delete_success'));
							} else {
								toast.error($t('app.retention_policies.delete_error'));
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="id" value={selectedPolicy.id} />
					<Button type="submit" variant="destructive" disabled={isDeleting}>
						{#if isDeleting}
							{$t('app.retention_policies.deleting')}
						{:else}
							{$t('app.retention_policies.confirm')}
						{/if}
					</Button>
				</form>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
