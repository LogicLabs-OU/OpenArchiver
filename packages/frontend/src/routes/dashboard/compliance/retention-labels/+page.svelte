<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { t } from '$lib/translations';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Tag } from 'lucide-svelte';
	import * as Table from '$lib/components/ui/table';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { enhance } from '$app/forms';
	import { MoreHorizontal, Plus } from 'lucide-svelte';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import type { RetentionLabel } from '@open-archiver/types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let labels = $derived(data.labels);

	// --- Dialog state ---
	let isCreateOpen = $state(false);
	let isEditOpen = $state(false);
	let isDeleteOpen = $state(false);
	let selectedLabel = $state<RetentionLabel | null>(null);
	let isFormLoading = $state(false);
	let isDeleting = $state(false);

	function openEdit(label: RetentionLabel) {
		selectedLabel = label;
		isEditOpen = true;
	}

	function openDelete(label: RetentionLabel) {
		selectedLabel = label;
		isDeleteOpen = true;
	}
</script>

<svelte:head>
	<title>{$t('app.retention_labels.title')} - Open Archiver</title>
	<meta name="description" content={$t('app.retention_labels.meta_description')} />
	<meta
		name="keywords"
		content="retention labels, data retention, email compliance, item-level retention, GDPR"
	/>
</svelte:head>

<div class="mb-6 flex items-center justify-between">
	<h1 class="text-2xl font-bold">{$t('app.retention_labels.header')}</h1>
	<Button onclick={() => (isCreateOpen = true)}>
		<Plus class="mr-1.5 h-4 w-4" />
		{$t('app.retention_labels.create_new')}
	</Button>
</div>

<div class="rounded-md border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>{$t('app.retention_labels.name')}</Table.Head>
				<Table.Head>{$t('app.retention_labels.retention_period')}</Table.Head>
				<Table.Head>{$t('app.retention_labels.applied_count')}</Table.Head>
				<Table.Head>{$t('app.retention_labels.status')}</Table.Head>
				<Table.Head>{$t('app.retention_labels.created_at')}</Table.Head>
				<Table.Head class="text-right">{$t('app.retention_labels.actions')}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if labels && labels.length > 0}
				{#each labels as label (label.id)}
					<Table.Row>
						<Table.Cell class="font-medium">
							<div>{label.name}</div>
							<div class="text-muted-foreground mt-0.5 font-mono text-[10px]">
								{label.id}
							</div>
							{#if label.description}
								<div class="text-muted-foreground mt-0.5 text-xs">
									{label.description}
								</div>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{label.retentionPeriodDays}
							{$t('app.retention_labels.days')}
						</Table.Cell>
						<!-- Applied email count — shows a subtle badge with the number -->
						<Table.Cell>
							<div class="flex items-center gap-1.5">
								<Tag class="text-muted-foreground h-3.5 w-3.5" />
								<Badge
									variant={label.appliedEmailCount > 0 ? 'secondary' : 'outline'}
								>
									{label.appliedEmailCount}
								</Badge>
							</div>
						</Table.Cell>
						<Table.Cell>
							{#if label.isDisabled}
								<Badge variant="secondary">
									{$t('app.retention_labels.disabled')}
								</Badge>
							{:else}
								<Badge variant="default" class="bg-green-500 text-white">
									{$t('app.retention_labels.enabled')}
								</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{new Date(label.createdAt).toLocaleDateString()}
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
									<DropdownMenu.Item onclick={() => openEdit(label)}>
										{$t('app.retention_labels.edit')}
									</DropdownMenu.Item>
									<DropdownMenu.Item
										class="text-destructive focus:text-destructive"
										onclick={() => openDelete(label)}
									>
										{label.appliedEmailCount > 0 && !label.isDisabled
											? $t('app.retention_labels.disable')
											: $t('app.retention_labels.delete')}
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</Table.Cell>
					</Table.Row>
				{/each}
			{:else}
				<Table.Row>
					<Table.Cell colspan={6} class="h-24 text-center">
						{$t('app.retention_labels.no_labels_found')}
					</Table.Cell>
				</Table.Row>
			{/if}
		</Table.Body>
	</Table.Root>
</div>

<!-- Create dialog -->
<Dialog.Root bind:open={isCreateOpen}>
	<Dialog.Content class="sm:max-w-[500px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.retention_labels.create')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.retention_labels.create_description')}
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/create"
			class="space-y-4"
			use:enhance={() => {
				isFormLoading = true;
				return async ({ result, update }) => {
					isFormLoading = false;
					if (result.type === 'success') {
						isCreateOpen = false;
						setAlert({
							type: 'success',
							title: $t('app.retention_labels.create_success'),
							message: '',
							duration: 3000,
							show: true,
						});
					} else if (result.type === 'failure') {
						setAlert({
							type: 'error',
							title: $t('app.retention_labels.create_error'),
							message: String(result.data?.message ?? ''),
							duration: 5000,
							show: true,
						});
					}
					await update();
				};
			}}
		>
			<div class="space-y-1.5">
				<Label for="create-name">{$t('app.retention_labels.name')}</Label>
				<Input
					id="create-name"
					name="name"
					required
					placeholder={$t('app.retention_labels.name_placeholder')}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="create-description">{$t('app.retention_labels.description')}</Label>
				<Textarea
					id="create-description"
					name="description"
					placeholder={$t('app.retention_labels.description_placeholder')}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="create-retention">
					{$t('app.retention_labels.retention_period_days')}
				</Label>
				<Input
					id="create-retention"
					name="retentionPeriodDays"
					type="number"
					min="1"
					required
				/>
			</div>
			<div class="flex justify-end gap-2">
				<Button
					type="button"
					variant="outline"
					onclick={() => (isCreateOpen = false)}
					disabled={isFormLoading}
				>
					{$t('app.retention_labels.cancel')}
				</Button>
				<Button type="submit" disabled={isFormLoading}>
					{#if isFormLoading}
						{$t('app.common.working')}
					{:else}
						{$t('app.retention_labels.create')}
					{/if}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Edit dialog -->
<Dialog.Root bind:open={isEditOpen}>
	<Dialog.Content class="sm:max-w-[500px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.retention_labels.edit')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.retention_labels.edit_description')}
			</Dialog.Description>
		</Dialog.Header>
		{#if selectedLabel}
			<form
				method="POST"
				action="?/update"
				class="space-y-4"
				use:enhance={() => {
					isFormLoading = true;
					return async ({ result, update }) => {
						isFormLoading = false;
						if (result.type === 'success') {
							isEditOpen = false;
							selectedLabel = null;
							setAlert({
								type: 'success',
								title: $t('app.retention_labels.update_success'),
								message: '',
								duration: 3000,
								show: true,
							});
						} else if (result.type === 'failure') {
							setAlert({
								type: 'error',
								title: $t('app.retention_labels.update_error'),
								message: String(result.data?.message ?? ''),
								duration: 5000,
								show: true,
							});
						}
						await update();
					};
				}}
			>
				<input type="hidden" name="id" value={selectedLabel.id} />
				<div class="space-y-1.5">
					<Label for="edit-name">{$t('app.retention_labels.name')}</Label>
					<Input id="edit-name" name="name" required value={selectedLabel.name} />
				</div>
				<div class="space-y-1.5">
					<Label for="edit-description">{$t('app.retention_labels.description')}</Label>
					<Textarea
						id="edit-description"
						name="description"
						value={selectedLabel.description ?? ''}
					/>
				</div>
				<div class="space-y-1.5">
					<Label for="edit-retention">
						{$t('app.retention_labels.retention_period_days')}
					</Label>
					<Input
						id="edit-retention"
						name="retentionPeriodDays"
						type="number"
						min="1"
						required
						value={selectedLabel.retentionPeriodDays}
					/>
					<p class="text-muted-foreground text-xs">
						{$t('app.retention_labels.retention_period_locked')}
					</p>
				</div>
				<div class="flex justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						onclick={() => (isEditOpen = false)}
						disabled={isFormLoading}
					>
						{$t('app.retention_labels.cancel')}
					</Button>
					<Button type="submit" disabled={isFormLoading}>
						{#if isFormLoading}
							{$t('app.common.working')}
						{:else}
							{$t('app.retention_labels.save')}
						{/if}
					</Button>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!--
  Delete / Disable / Force-delete confirmation dialog.
  Three cases driven by (isDisabled, appliedEmailCount):
    1. appliedEmailCount === 0          → hard-delete (no emails, safe to remove)
    2. appliedEmailCount > 0, enabled   → soft-disable (keep email retention clocks)
    3. appliedEmailCount > 0, disabled  → force hard-delete (remove relations + label)
-->
<Dialog.Root bind:open={isDeleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				{#if (selectedLabel?.appliedEmailCount ?? 0) > 0 && !selectedLabel?.isDisabled}
					{$t('app.retention_labels.disable_confirmation_title')}
				{:else if (selectedLabel?.appliedEmailCount ?? 0) > 0 && selectedLabel?.isDisabled}
					{$t('app.retention_labels.force_delete_confirmation_title')}
				{:else}
					{$t('app.retention_labels.delete_confirmation_title')}
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if (selectedLabel?.appliedEmailCount ?? 0) > 0 && !selectedLabel?.isDisabled}
					{$t('app.retention_labels.disable_confirmation_description')}
				{:else if (selectedLabel?.appliedEmailCount ?? 0) > 0 && selectedLabel?.isDisabled}
					{$t('app.retention_labels.force_delete_confirmation_description')}
				{:else}
					{$t('app.retention_labels.delete_confirmation_description')}
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (isDeleteOpen = false)} disabled={isDeleting}>
				{$t('app.retention_labels.cancel')}
			</Button>
			{#if selectedLabel}
				<form
					method="POST"
					action="?/delete"
					use:enhance={() => {
						isDeleting = true;
						return async ({ result, update }) => {
							isDeleting = false;
							if (result.type === 'success') {
								isDeleteOpen = false;
								const action = result.data?.action;
								setAlert({
									type: 'success',
									title:
										action === 'disabled'
											? $t('app.retention_labels.disable_success')
											: $t('app.retention_labels.delete_success'),
									message: '',
									duration: 3000,
									show: true,
								});
								selectedLabel = null;
							} else if (result.type === 'failure') {
								setAlert({
									type: 'error',
									title: $t('app.retention_labels.delete_error'),
									message: String(result.data?.message ?? ''),
									duration: 5000,
									show: true,
								});
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="id" value={selectedLabel.id} />
					<Button type="submit" variant="destructive" disabled={isDeleting}>
						{#if isDeleting}
							{$t('app.retention_labels.deleting')}
						{:else if (selectedLabel.appliedEmailCount ?? 0) > 0 && !selectedLabel.isDisabled}
							{$t('app.retention_labels.disable')}
						{:else}
							{$t('app.retention_labels.confirm')}
						{/if}
					</Button>
				</form>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
