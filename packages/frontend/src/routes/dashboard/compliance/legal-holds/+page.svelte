<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { t } from '$lib/translations';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { enhance } from '$app/forms';
	import { MoreHorizontal, Plus, ShieldCheck } from 'lucide-svelte';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import type { LegalHold } from '@open-archiver/types';

	let { data }: { data: PageData; form: ActionData } = $props();

	let holds = $derived(data.holds);

	// --- Dialog state ---
	let isCreateOpen = $state(false);
	let isEditOpen = $state(false);
	let isDeleteOpen = $state(false);
	let isBulkApplyOpen = $state(false);
	let isReleaseAllOpen = $state(false);

	let selectedHold = $state<LegalHold | null>(null);
	let isFormLoading = $state(false);

	// Bulk apply search query fields
	let bulkQuery = $state('');
	let bulkFiltersFrom = $state('');
	let bulkFiltersDateStart = $state('');
	let bulkFiltersDateEnd = $state('');

	function openEdit(hold: LegalHold) {
		selectedHold = hold;
		isEditOpen = true;
	}

	function openDelete(hold: LegalHold) {
		selectedHold = hold;
		isDeleteOpen = true;
	}

	function openBulkApply(hold: LegalHold) {
		selectedHold = hold;
		bulkQuery = '';
		bulkFiltersFrom = '';
		bulkFiltersDateStart = '';
		bulkFiltersDateEnd = '';
		isBulkApplyOpen = true;
	}

	function openReleaseAll(hold: LegalHold) {
		selectedHold = hold;
		isReleaseAllOpen = true;
	}

	/** Builds a SearchQuery JSON string from the bulk apply form fields. */
	function buildSearchQuery(): string {
		const filters: Record<string, string> = {};
		if (bulkFiltersFrom) filters['from'] = bulkFiltersFrom;
		if (bulkFiltersDateStart) filters['startDate'] = bulkFiltersDateStart;
		if (bulkFiltersDateEnd) filters['endDate'] = bulkFiltersDateEnd;

		return JSON.stringify({
			query: bulkQuery,
			filters: Object.keys(filters).length > 0 ? filters : undefined,
			matchingStrategy: 'all',
		});
	}
</script>

<svelte:head>
	<title>{$t('app.legal_holds.title')} - Open Archiver</title>
	<meta name="description" content={$t('app.legal_holds.meta_description')} />
	<meta
		name="keywords"
		content="legal hold, eDiscovery, compliance, litigation hold, evidence preservation, spoliation prevention"
	/>
</svelte:head>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-bold">{$t('app.legal_holds.header')}</h1>
	</div>
	<Button onclick={() => (isCreateOpen = true)}>
		<Plus class="mr-1.5 h-4 w-4" />
		{$t('app.legal_holds.create_new')}
	</Button>
</div>

<div class="rounded-md border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>{$t('app.legal_holds.name')}</Table.Head>
				<Table.Head>{$t('app.legal_holds.reason')}</Table.Head>
				<Table.Head>{$t('app.legal_holds.email_count')}</Table.Head>
				<Table.Head>{$t('app.legal_holds.status')}</Table.Head>
				<Table.Head>{$t('app.legal_holds.created_at')}</Table.Head>
				<Table.Head class="text-right">{$t('app.legal_holds.actions')}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if holds && holds.length > 0}
				{#each holds as hold (hold.id)}
					<Table.Row>
						<Table.Cell class="font-medium">
							<div class="flex items-center gap-2">
								<div>
									<div>{hold.name}</div>
									<div class="text-muted-foreground mt-0.5 font-mono text-[10px]">
										{hold.id}
									</div>
								</div>
							</div>
						</Table.Cell>
						<Table.Cell class="max-w-[300px]">
							{#if hold.reason}
								<span class="text-muted-foreground line-clamp-2 text-xs"
									>{hold.reason}</span
								>
							{:else}
								<span class="text-muted-foreground text-xs italic">
									{$t('app.legal_holds.no_reason')}
								</span>
							{/if}
						</Table.Cell>
						<Table.Cell>
							<div class="flex items-center gap-1.5">
								<ShieldCheck class="text-muted-foreground h-3.5 w-3.5" />
								<Badge variant={hold.emailCount > 0 ? 'secondary' : 'outline'}>
									{hold.emailCount}
								</Badge>
							</div>
						</Table.Cell>
						<Table.Cell>
							{#if hold.isActive}
								<Badge class="bg-destructive text-white">
									{$t('app.legal_holds.active')}
								</Badge>
							{:else}
								<Badge variant="secondary">
									{$t('app.legal_holds.inactive')}
								</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{new Date(hold.createdAt).toLocaleDateString()}
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
									<DropdownMenu.Item onclick={() => openEdit(hold)}>
										{$t('app.legal_holds.edit')}
									</DropdownMenu.Item>
									{#if hold.isActive}
										<DropdownMenu.Item onclick={() => openBulkApply(hold)}>
											{$t('app.legal_holds.bulk_apply')}
										</DropdownMenu.Item>
									{/if}
									{#if hold.emailCount > 0}
										<DropdownMenu.Item onclick={() => openReleaseAll(hold)}>
											{$t('app.legal_holds.release_all')}
										</DropdownMenu.Item>
									{/if}
									<!-- Toggle active/inactive -->
									<form
										method="POST"
										action="?/toggleActive"
										use:enhance={() => {
											return async ({ result, update }) => {
												if (
													result.type === 'success' &&
													result.data?.success !== false
												) {
													const newState = result.data
														?.isActive as boolean;
													setAlert({
														type: 'success',
														title: newState
															? $t(
																	'app.legal_holds.activated_success'
																)
															: $t(
																	'app.legal_holds.deactivated_success'
																),
														message: '',
														duration: 3000,
														show: true,
													});
												} else if (
													result.type === 'success' &&
													result.data?.success === false
												) {
													setAlert({
														type: 'error',
														title: $t('app.legal_holds.update_error'),
														message: String(result.data?.message ?? ''),
														duration: 5000,
														show: true,
													});
												}
												await update();
											};
										}}
									>
										<input type="hidden" name="id" value={hold.id} />
										<input
											type="hidden"
											name="isActive"
											value={String(!hold.isActive)}
										/>
										<DropdownMenu.Item>
											<button type="submit" class="w-full text-left">
												{hold.isActive
													? $t('app.legal_holds.deactivate')
													: $t('app.legal_holds.activate')}
											</button>
										</DropdownMenu.Item>
									</form>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										class="text-destructive focus:text-destructive"
										onclick={() => openDelete(hold)}
									>
										{$t('app.legal_holds.delete')}
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</Table.Cell>
					</Table.Row>
				{/each}
			{:else}
				<Table.Row>
					<Table.Cell colspan={6} class="h-24 text-center">
						{$t('app.legal_holds.no_holds_found')}
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
			<Dialog.Title>{$t('app.legal_holds.create')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.legal_holds.create_description')}
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
					if (result.type === 'success' && result.data?.success !== false) {
						isCreateOpen = false;
						setAlert({
							type: 'success',
							title: $t('app.legal_holds.create_success'),
							message: '',
							duration: 3000,
							show: true,
						});
					} else if (result.type === 'success' && result.data?.success === false) {
						setAlert({
							type: 'error',
							title: $t('app.legal_holds.create_error'),
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
				<Label for="create-name">{$t('app.legal_holds.name')}</Label>
				<Input
					id="create-name"
					name="name"
					required
					placeholder={$t('app.legal_holds.name_placeholder')}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="create-reason">{$t('app.legal_holds.reason')}</Label>
				<Textarea
					id="create-reason"
					name="reason"
					placeholder={$t('app.legal_holds.reason_placeholder')}
				/>
			</div>
			<div class="flex justify-end gap-2">
				<Button
					type="button"
					variant="outline"
					onclick={() => (isCreateOpen = false)}
					disabled={isFormLoading}
				>
					{$t('app.legal_holds.cancel')}
				</Button>
				<Button type="submit" disabled={isFormLoading}>
					{#if isFormLoading}
						{$t('app.common.working')}
					{:else}
						{$t('app.legal_holds.create')}
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
			<Dialog.Title>{$t('app.legal_holds.edit')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.legal_holds.edit_description')}
			</Dialog.Description>
		</Dialog.Header>
		{#if selectedHold}
			<form
				method="POST"
				action="?/update"
				class="space-y-4"
				use:enhance={() => {
					isFormLoading = true;
					return async ({ result, update }) => {
						isFormLoading = false;
						if (result.type === 'success' && result.data?.success !== false) {
							isEditOpen = false;
							selectedHold = null;
							setAlert({
								type: 'success',
								title: $t('app.legal_holds.update_success'),
								message: '',
								duration: 3000,
								show: true,
							});
						} else if (result.type === 'success' && result.data?.success === false) {
							setAlert({
								type: 'error',
								title: $t('app.legal_holds.update_error'),
								message: String(result.data?.message ?? ''),
								duration: 5000,
								show: true,
							});
						}
						await update();
					};
				}}
			>
				<input type="hidden" name="id" value={selectedHold.id} />
				<div class="space-y-1.5">
					<Label for="edit-name">{$t('app.legal_holds.name')}</Label>
					<Input id="edit-name" name="name" required value={selectedHold.name} />
				</div>
				<div class="space-y-1.5">
					<Label for="edit-reason">{$t('app.legal_holds.reason')}</Label>
					<Textarea id="edit-reason" name="reason" value={selectedHold.reason ?? ''} />
				</div>
				<div class="flex justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						onclick={() => (isEditOpen = false)}
						disabled={isFormLoading}
					>
						{$t('app.legal_holds.cancel')}
					</Button>
					<Button type="submit" disabled={isFormLoading}>
						{#if isFormLoading}
							{$t('app.common.working')}
						{:else}
							{$t('app.legal_holds.save')}
						{/if}
					</Button>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Bulk Apply dialog -->
<Dialog.Root bind:open={isBulkApplyOpen}>
	<Dialog.Content class="sm:max-w-[560px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.legal_holds.bulk_apply_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.legal_holds.bulk_apply_description')}
			</Dialog.Description>
		</Dialog.Header>
		{#if selectedHold}
			<form
				method="POST"
				action="?/bulkApply"
				class="space-y-4"
				use:enhance={() => {
					isFormLoading = true;
					return async ({ result, update }) => {
						isFormLoading = false;
						if (result.type === 'success' && result.data?.success !== false) {
							isBulkApplyOpen = false;
							const count = result.data?.emailsLinked as number;
							setAlert({
								type: 'success',
								title: $t('app.legal_holds.bulk_apply_success'),
								message: `${count} email(s) placed under legal hold.`,
								duration: 5000,
								show: true,
							});
						} else if (result.type === 'success' && result.data?.success === false) {
							setAlert({
								type: 'error',
								title: $t('app.legal_holds.bulk_apply_error'),
								message: String(result.data?.message ?? ''),
								duration: 5000,
								show: true,
							});
						}
						await update();
					};
				}}
			>
				<input type="hidden" name="holdId" value={selectedHold.id} />
				<!-- Hidden input built from the reactive fields -->
				<input type="hidden" name="searchQuery" value={buildSearchQuery()} />

				<div class="space-y-1.5">
					<Label for="bulk-query">{$t('app.legal_holds.bulk_query')}</Label>
					<Input
						id="bulk-query"
						bind:value={bulkQuery}
						placeholder={$t('app.legal_holds.bulk_query_placeholder')}
					/>
					<p class="text-muted-foreground text-xs">
						{$t('app.legal_holds.bulk_query_hint')}
					</p>
				</div>
				<div class="space-y-1.5">
					<Label for="bulk-from">{$t('app.legal_holds.bulk_from')}</Label>
					<Input
						id="bulk-from"
						bind:value={bulkFiltersFrom}
						placeholder="e.g. john@company.com"
					/>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="bulk-start">{$t('app.legal_holds.bulk_date_start')}</Label>
						<Input id="bulk-start" type="date" bind:value={bulkFiltersDateStart} />
					</div>
					<div class="space-y-1.5">
						<Label for="bulk-end">{$t('app.legal_holds.bulk_date_end')}</Label>
						<Input id="bulk-end" type="date" bind:value={bulkFiltersDateEnd} />
					</div>
				</div>
				<div
					class="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950"
				>
					<p class="text-xs text-amber-800 dark:text-amber-200">
						{$t('app.legal_holds.bulk_apply_warning')}
					</p>
				</div>
				<div class="flex justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						onclick={() => (isBulkApplyOpen = false)}
						disabled={isFormLoading}
					>
						{$t('app.legal_holds.cancel')}
					</Button>
					<Button
						type="submit"
						disabled={isFormLoading ||
							(!bulkQuery && !bulkFiltersFrom && !bulkFiltersDateStart)}
					>
						{#if isFormLoading}
							{$t('app.common.working')}
						{:else}
							{$t('app.legal_holds.bulk_apply_confirm')}
						{/if}
					</Button>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Release All dialog -->
<Dialog.Root bind:open={isReleaseAllOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$t('app.legal_holds.release_all_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.legal_holds.release_all_description')}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => (isReleaseAllOpen = false)}
				disabled={isFormLoading}
			>
				{$t('app.legal_holds.cancel')}
			</Button>
			{#if selectedHold}
				<form
					method="POST"
					action="?/releaseAll"
					use:enhance={() => {
						isFormLoading = true;
						return async ({ result, update }) => {
							isFormLoading = false;
							if (result.type === 'success' && result.data?.success !== false) {
								isReleaseAllOpen = false;
								const count = result.data?.emailsReleased as number;
								setAlert({
									type: 'success',
									title: $t('app.legal_holds.release_all_success'),
									message: `${count} email(s) released from hold.`,
									duration: 4000,
									show: true,
								});
								selectedHold = null;
							} else {
								setAlert({
									type: 'error',
									title: $t('app.legal_holds.release_all_error'),
									message:
										result.type === 'success'
											? String(result.data?.message ?? '')
											: '',
									duration: 5000,
									show: true,
								});
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="id" value={selectedHold.id} />
					<Button type="submit" variant="destructive" disabled={isFormLoading}>
						{#if isFormLoading}
							{$t('app.common.working')}
						{:else}
							{$t('app.legal_holds.release_all_confirm')}
						{/if}
					</Button>
				</form>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete confirmation dialog -->
<Dialog.Root bind:open={isDeleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$t('app.legal_holds.delete_confirmation_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.legal_holds.delete_confirmation_description')}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => (isDeleteOpen = false)}
				disabled={isFormLoading}
			>
				{$t('app.legal_holds.cancel')}
			</Button>
			{#if selectedHold}
				<form
					method="POST"
					action="?/delete"
					use:enhance={() => {
						isFormLoading = true;
						return async ({ result, update }) => {
							isFormLoading = false;
							if (result.type === 'success' && result.data?.success !== false) {
								isDeleteOpen = false;
								setAlert({
									type: 'success',
									title: $t('app.legal_holds.delete_success'),
									message: '',
									duration: 3000,
									show: true,
								});
								selectedHold = null;
							} else {
								setAlert({
									type: 'error',
									title: $t('app.legal_holds.delete_error'),
									message:
										result.type === 'success'
											? String(result.data?.message ?? '')
											: '',
									duration: 5000,
									show: true,
								});
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="id" value={selectedHold.id} />
					<Button type="submit" variant="destructive" disabled={isFormLoading}>
						{#if isFormLoading}
							{$t('app.common.working')}
						{:else}
							{$t('app.legal_holds.confirm')}
						{/if}
					</Button>
				</form>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
