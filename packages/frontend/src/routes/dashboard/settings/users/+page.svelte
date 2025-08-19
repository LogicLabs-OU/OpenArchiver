<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { MoreHorizontal, Trash, Edit } from 'lucide-svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import UserForm from '$lib/components/custom/UserForm.svelte';
	import { api } from '$lib/api.client';
	import type { User } from '@open-archiver/types';

	let { data }: { data: PageData } = $props();
	let users = $state(data.users);
	let roles = $state(data.roles);
	let isDialogOpen = $state(false);
	let isDeleteDialogOpen = $state(false);
	let selectedUser = $state<User | null>(null);
	let userToDelete = $state<User | null>(null);
	let isDeleting = $state(false);

	const openCreateDialog = () => {
		selectedUser = null;
		isDialogOpen = true;
	};

	const openEditDialog = (user: User) => {
		selectedUser = user;
		isDialogOpen = true;
	};

	const openDeleteDialog = (user: User) => {
		userToDelete = user;
		isDeleteDialogOpen = true;
	};

	const confirmDelete = async () => {
		if (!userToDelete) return;
		isDeleting = true;
		try {
			const res = await api(`/users/${userToDelete.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const errorBody = await res.json();
				setAlert({
					type: 'error',
					title: 'Failed to delete user',
					message: errorBody.message || JSON.stringify(errorBody),
					duration: 5000,
					show: true,
				});
				return;
			}
			users = users.filter((u) => u.id !== userToDelete!.id);
			isDeleteDialogOpen = false;
			userToDelete = null;
		} finally {
			isDeleting = false;
		}
	};

	const handleFormSubmit = async (formData: Partial<User> & { roleId: string }) => {
		try {
			if (selectedUser) {
				// Update
				const response = await api(`/users/${selectedUser.id}`, {
					method: 'PUT',
					body: JSON.stringify(formData),
				});
				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(errorData.message || 'Failed to update user.');
				}
				const updatedUser: User = await response.json();
				users = users.map((u: User) => (u.id === updatedUser.id ? updatedUser : u));
			} else {
				// Create
				const response = await api('/users', {
					method: 'POST',
					body: JSON.stringify(formData),
				});
				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(errorData.message || 'Failed to create user.');
				}
				const newUser: User = await response.json();
				users = [...users, newUser];
			}
			isDialogOpen = false;
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
	<title>User Management - OpenArchiver</title>
</svelte:head>

<div class="">
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-2xl font-bold">User Management</h1>
		<Button onclick={openCreateDialog}>Create New</Button>
	</div>

	<div class="rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Name</Table.Head>
					<Table.Head>Email</Table.Head>
					<Table.Head>Role</Table.Head>
					<Table.Head>Created At</Table.Head>
					<Table.Head class="text-right">Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if users.length > 0}
					{#each users as user (user.id)}
						<Table.Row>
							<Table.Cell>{user.first_name} {user.last_name}</Table.Cell>
							<Table.Cell>{user.email}</Table.Cell>
							<Table.Cell>{user.role?.name || 'N/A'}</Table.Cell>
							<Table.Cell>{new Date(user.createdAt).toLocaleDateString()}</Table.Cell>
							<Table.Cell class="text-right">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										<Button variant="ghost" class="h-8 w-8 p-0">
											<span class="sr-only">Open menu</span>
											<MoreHorizontal class="h-4 w-4" />
										</Button>
									</DropdownMenu.Trigger>
									<DropdownMenu.Content>
										<DropdownMenu.Label>Actions</DropdownMenu.Label>
										<DropdownMenu.Item
											onclick={() => openEditDialog(user)}
											class="cursor-pointer"
										>
											<Edit class="mr-2 h-4 w-4" />
											Edit</DropdownMenu.Item
										>
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											class="text-destructive cursor-pointer"
											onclick={() => openDeleteDialog(user)}
										>
											<Trash class="mr-2 h-4 w-4" />
											Delete
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				{:else}
					<Table.Row>
						<Table.Cell colspan={5} class="h-24 text-center">No users found.</Table.Cell
						>
					</Table.Row>
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<Dialog.Root bind:open={isDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{selectedUser ? 'Edit' : 'Create'} User</Dialog.Title>
			<Dialog.Description>
				{selectedUser ? 'Make changes to the user here.' : 'Add a new user to the system.'}
			</Dialog.Description>
		</Dialog.Header>
		<UserForm {roles} user={selectedUser} onSubmit={handleFormSubmit} />
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={isDeleteDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Are you sure you want to delete this user?</Dialog.Title>
			<Dialog.Description>
				This action cannot be undone. This will permanently delete the user and remove their
				data from our servers.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="sm:justify-start">
			<Button
				type="button"
				variant="destructive"
				onclick={confirmDelete}
				disabled={isDeleting}
			>
				{#if isDeleting}Deleting...{:else}Confirm{/if}
			</Button>
			<Dialog.Close>
				<Button type="button" variant="secondary">Cancel</Button>
			</Dialog.Close>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
