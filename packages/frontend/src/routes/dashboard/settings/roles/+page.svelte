<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { MoreHorizontal, Trash, Eye, Edit } from 'lucide-svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import RoleForm from '$lib/components/custom/RoleForm.svelte';
	import { api } from '$lib/api.client';
	import type { Role } from '@open-archiver/types';
	import { t } from '$lib/translations';

	let { data }: { data: PageData } = $props();
	let roles = $state(data.roles);
	let isViewPolicyDialogOpen = $state(false);
	let isFormDialogOpen = $state(false);
	let isDeleteDialogOpen = $state(false);
	let selectedRole = $state<Role | null>(null);
	let roleToDelete = $state<Role | null>(null);
	let isDeleting = $state(false);

	const openCreateDialog = () => {
		selectedRole = null;
		isFormDialogOpen = true;
	};

	const openEditDialog = (role: Role) => {
		selectedRole = role;
		isFormDialogOpen = true;
	};

	const openViewPolicyDialog = (role: Role) => {
		selectedRole = role;
		isViewPolicyDialogOpen = true;
	};

	const openDeleteDialog = (role: Role) => {
		roleToDelete = role;
		isDeleteDialogOpen = true;
	};

	const confirmDelete = async () => {
		if (!roleToDelete) return;
		isDeleting = true;
		try {
			const res = await api(`/iam/roles/${roleToDelete.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const errorBody = await res.json();
				setAlert({
					type: 'error',
					title: 'Failed to delete role',
					message: errorBody.message || JSON.stringify(errorBody),
					duration: 5000,
					show: true,
				});
				return;
			}
			roles = roles.filter((r) => r.id !== roleToDelete!.id);
			isDeleteDialogOpen = false;
			roleToDelete = null;
		} finally {
			isDeleting = false;
		}
	};

	const handleFormSubmit = async (formData: Partial<Role>) => {
		try {
			if (selectedRole) {
				// Update
				const response = await api(`/iam/roles/${selectedRole.id}`, {
					method: 'PUT',
					body: JSON.stringify(formData),
				});
				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(errorData.message || 'Failed to update role.');
				}
				const updatedRole: Role = await response.json();
				roles = roles.map((r: Role) => (r.id === updatedRole.id ? updatedRole : r));
			} else {
				// Create
				const response = await api('/iam/roles', {
					method: 'POST',
					body: JSON.stringify(formData),
				});
				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(errorData.message || 'Failed to create role.');
				}
				const newRole: Role = await response.json();
				roles = [...roles, newRole];
			}
			isFormDialogOpen = false;
		} catch (error) {
			let message = 'An unknown error occurred.';
			if (error instanceof Error) {
				message = error.message;
			}
			setAlert({
				type: 'error',
				title: 'Operation Failed',
				message,
				duration: 5000,
				show: true,
			});
		}
	};
</script>

<svelte:head>
	<title>{$t('app.roles.title')} - OpenArchiver</title>
</svelte:head>

<div class="">
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-2xl font-bold">{$t('app.roles.role_management')}</h1>
		<Button onclick={openCreateDialog}>{$t('app.roles.create_new')}</Button>
	</div>

	<div class="rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>{$t('app.roles.name')}</Table.Head>
					<Table.Head>{$t('app.roles.created_at')}</Table.Head>
					<Table.Head class="text-right">{$t('app.roles.actions')}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if roles.length > 0}
					{#each roles as role (role.id)}
						<Table.Row>
							<Table.Cell>{role.name}</Table.Cell>
							<Table.Cell>{new Date(role.createdAt).toLocaleDateString()}</Table.Cell>
							<Table.Cell class="text-right">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										<Button variant="ghost" class="h-8 w-8 p-0">
											<span class="sr-only">{$t('app.roles.open_menu')}</span>
											<MoreHorizontal class="h-4 w-4" />
										</Button>
									</DropdownMenu.Trigger>
									<DropdownMenu.Content>
										<DropdownMenu.Label
											>{$t('app.roles.actions')}</DropdownMenu.Label
										>
										<DropdownMenu.Item
											onclick={() => openViewPolicyDialog(role)}
											class="cursor-pointer"
										>
											<Eye class="mr-2 h-4 w-4" />
											{$t('app.roles.view_policy')}
										</DropdownMenu.Item>
										<DropdownMenu.Item
											onclick={() => openEditDialog(role)}
											class="cursor-pointer"
										>
											<Edit class="mr-2 h-4 w-4" />
											{$t('app.roles.edit')}
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											class="text-destructive cursor-pointer"
											onclick={() => openDeleteDialog(role)}
										>
											<Trash class="mr-2 h-4 w-4" />
											{$t('app.roles.delete')}
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				{:else}
					<Table.Row>
						<Table.Cell colspan={3} class="h-24 text-center"
							>{$t('app.roles.no_roles_found')}</Table.Cell
						>
					</Table.Row>
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<Dialog.Root bind:open={isViewPolicyDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{$t('app.roles.role_policy')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.roles.viewing_policy_for_role', { name: selectedRole?.name } as any)}
			</Dialog.Description>
		</Dialog.Header>
		<div
			class=" max-h-98 overflow-x-auto overflow-y-auto rounded-md bg-gray-900 p-2 text-white"
		>
			<pre>{JSON.stringify(selectedRole?.policies, null, 2)}</pre>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={isFormDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title
				>{selectedRole ? $t('app.roles.edit') : $t('app.roles.create')}
				{$t('app.roles.role')}</Dialog.Title
			>
			<Dialog.Description>
				{selectedRole
					? $t('app.roles.edit_description')
					: $t('app.roles.create_description')}
			</Dialog.Description>
		</Dialog.Header>
		<RoleForm role={selectedRole} onSubmit={handleFormSubmit} />
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={isDeleteDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{$t('app.roles.delete_confirmation_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.roles.delete_confirmation_description')}
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
					{$t('app.roles.deleting')}...
				{:else}
					{$t('app.roles.confirm')}
				{/if}
			</Button>
			<Dialog.Close>
				<Button type="button" variant="secondary">{$t('app.roles.cancel')}</Button>
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
