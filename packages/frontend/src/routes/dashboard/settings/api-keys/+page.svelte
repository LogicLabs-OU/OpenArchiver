<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import type { ActionData, PageData } from './$types';
	import { t } from '$lib/translations';
	import { MoreHorizontal, Trash } from 'lucide-svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { api } from '$lib/api.client';

	// Temporary type definition based on the backend schema
	type ApiKey = {
		id: string;
		name: string;
		userId: string;
		key: string;
		expiresAt: Date;
		createdAt: Date;
		updatedAt: Date;
	};

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let apiKeys = $state<ApiKey[]>(data.apiKeys);

	let isDeleteDialogOpen = $state(false);
	let newAPIKeyDialogOpen = $state(false);
	let keyToDelete = $state<ApiKey | null>(null);
	let isDeleting = $state(false);
	let selectedExpiration = $state('30');
	const expirationOptions = [
		{ value: '30', label: $t('app.api_keys_page.30_days') },
		{ value: '60', label: $t('app.api_keys_page.60_days') },
		{ value: '180', label: $t('app.api_keys_page.6_months') },
		{ value: '365', label: $t('app.api_keys_page.12_months') },
		{ value: '730', label: $t('app.api_keys_page.24_months') },
	];
	const triggerContent = $derived(
		expirationOptions.find((p) => p.value === selectedExpiration)?.label ??
			$t('app.api_keys_page.select_expiration')
	);

	const openDeleteDialog = (apiKey: ApiKey) => {
		keyToDelete = apiKey;
		isDeleteDialogOpen = true;
	};

	const confirmDelete = async () => {
		if (!keyToDelete) return;
		isDeleting = true;
		try {
			const res = await api(`/api-keys/${keyToDelete.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const errorBody = await res.json();
				setAlert({
					type: 'error',
					title: $t('app.api_keys_page.failed_to_delete'),
					message: errorBody.message || JSON.stringify(errorBody),
					duration: 5000,
					show: true,
				});
				return;
			}
			apiKeys = apiKeys.filter((k) => k.id !== keyToDelete!.id);
			isDeleteDialogOpen = false;
			keyToDelete = null;
			setAlert({
				type: 'success',
				title: $t('app.api_keys_page.api_key_deleted'),
				message: $t('app.api_keys_page.api_key_deleted'),
				duration: 3000,
				show: true,
			});
		} finally {
			isDeleting = false;
		}
	};

	$effect(() => {
		if (form?.newApiKey) {
			setAlert({
				type: 'success',
				title: $t('app.api_keys_page.generated_title'),
				message: $t('app.api_keys_page.generated_message'),
				duration: 3000, // Keep it on screen longer for copying
				show: true,
			});
		}
		if (form?.errors) {
			setAlert({
				type: 'error',
				title: form.message,
				message: form.errors || '',
				duration: 3000, // Keep it on screen longer for copying
				show: true,
			});
		}
	});
</script>

<svelte:head>
	<title>{$t('app.api_keys_page.title')} - Open Archiver</title>
</svelte:head>

<div class="">
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-2xl font-bold">{$t('app.api_keys_page.title')}</h1>
		<Dialog.Root bind:open={newAPIKeyDialogOpen}>
			<Dialog.Trigger>
				<Button>{$t('app.api_keys_page.generate_new_key')}</Button>
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>{$t('app.api_keys_page.generate_modal_title')}</Dialog.Title>
					<Dialog.Description>
						{$t('app.api_keys_page.generate_modal_description')}
					</Dialog.Description>
				</Dialog.Header>
				<form
					method="POST"
					action="?/generate"
					onsubmit={() => {
						newAPIKeyDialogOpen = false;
					}}
				>
					<div class="grid gap-4 py-4">
						<div class="grid grid-cols-4 items-center gap-4">
							<Label for="name" class="text-right"
								>{$t('app.api_keys_page.name')}</Label
							>
							<Input id="name" name="name" class="col-span-3" />
						</div>
						<div class="grid grid-cols-4 items-center gap-4">
							<Label for="expiresInDays" class="text-right"
								>{$t('app.api_keys_page.expires_in')}</Label
							>
							<Select.Root
								name="expiresInDays"
								bind:value={selectedExpiration}
								type="single"
							>
								<Select.Trigger class="col-span-3">
									{triggerContent}
								</Select.Trigger>
								<Select.Content>
									{#each expirationOptions as option}
										<Select.Item value={option.value}
											>{option.label}</Select.Item
										>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>
					<Dialog.Footer>
						<Button type="submit">{$t('app.api_keys_page.generate')}</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	</div>
	{#if form?.newApiKey}
		<Card.Root class="mb-4 border-0 bg-green-200 text-green-600 shadow-none">
			<Card.Header>
				<Card.Title>{$t('app.api_keys_page.generated_title')}</Card.Title>
				<Card.Description class=" text-green-600"
					>{$t('app.api_keys_page.generated_message')}</Card.Description
				>
			</Card.Header>
			<Card.Content>
				<p>{form?.newApiKey}</p>
			</Card.Content>
		</Card.Root>
	{/if}

	<div class="rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>{$t('app.api_keys_page.name')}</Table.Head>
					<Table.Head>{$t('app.api_keys_page.key')}</Table.Head>
					<Table.Head>{$t('app.api_keys_page.expires_at')}</Table.Head>
					<Table.Head>{$t('app.api_keys_page.created_at')}</Table.Head>
					<Table.Head class="text-right">{$t('app.users.actions')}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if apiKeys.length > 0}
					{#each apiKeys as apiKey (apiKey.id)}
						<Table.Row>
							<Table.Cell>{apiKey.name}</Table.Cell>
							<Table.Cell>{apiKey.key.substring(0, 8)}</Table.Cell>
							<Table.Cell
								>{new Date(apiKey.expiresAt).toLocaleDateString()}</Table.Cell
							>
							<Table.Cell
								>{new Date(apiKey.createdAt).toLocaleDateString()}</Table.Cell
							>
							<Table.Cell class="text-right">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										<Button variant="ghost" class="h-8 w-8 p-0">
											<span class="sr-only">{$t('app.users.open_menu')}</span>
											<MoreHorizontal class="h-4 w-4" />
										</Button>
									</DropdownMenu.Trigger>
									<DropdownMenu.Content>
										<DropdownMenu.Label
											>{$t('app.users.actions')}</DropdownMenu.Label
										>
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											class="text-destructive cursor-pointer"
											onclick={() => openDeleteDialog(apiKey)}
										>
											<Trash class="mr-2 h-4 w-4" />
											{$t('app.users.delete')}
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				{:else}
					<Table.Row>
						<Table.Cell colspan={5} class="h-24 text-center"
							>{$t('app.api_keys_page.no_keys_found')}</Table.Cell
						>
					</Table.Row>
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<Dialog.Root bind:open={isDeleteDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{$t('app.users.delete_confirmation_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.users.delete_confirmation_description')}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="sm:justify-start">
			<Button
				type="button"
				variant="destructive"
				onclick={confirmDelete}
				disabled={isDeleting}
			>
				{#if isDeleting}
					{$t('app.users.deleting')}...
				{:else}
					{$t('app.users.confirm')}
				{/if}
			</Button>
			<Dialog.Close>
				<Button type="button" variant="secondary">{$t('app.users.cancel')}</Button>
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
