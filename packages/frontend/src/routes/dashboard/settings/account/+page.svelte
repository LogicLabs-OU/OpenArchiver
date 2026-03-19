<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/translations';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';

	let { data, form } = $props();
	let user = $derived(data.user);

	let isProfileDialogOpen = $state(false);
	let isPasswordDialogOpen = $state(false);
	let isSubmitting = $state(false);

	// Profile form state
	let profileFirstName = $state('');
	let profileLastName = $state('');
	let profileEmail = $state('');

	// Password form state
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmNewPassword = $state('');

	// Preload profile form
	$effect(() => {
		if (user && isProfileDialogOpen) {
			profileFirstName = user.first_name || '';
			profileLastName = user.last_name || '';
			profileEmail = user.email || '';
		}
	});

	// Handle form actions result
	$effect(() => {
		if (form) {
			isSubmitting = false;
			if (form.success) {
				isProfileDialogOpen = false;
				isPasswordDialogOpen = false;
				setAlert({
					type: 'success',
					title: $t('app.account.operation_successful'),
					message: $t('app.account.operation_successful'),
					duration: 3000,
					show: true,
				});
			} else if (form.profileError || form.passwordError) {
				setAlert({
					type: 'error',
					title: $t('app.search.error'),
					message: form.message,
					duration: 3000,
					show: true,
				});
			}
		}
	});

	function openProfileDialog() {
		isProfileDialogOpen = true;
	}

	function openPasswordDialog() {
		currentPassword = '';
		newPassword = '';
		confirmNewPassword = '';
		isPasswordDialogOpen = true;
	}
</script>

<svelte:head>
	<title>{$t('app.account.title')} - OpenArchiver</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">{$t('app.account.title')}</h1>
		<p class="text-muted-foreground">{$t('app.account.description')}</p>
	</div>

	<!-- Personal Information -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{$t('app.account.personal_info')}</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<div>
					<Label class="text-muted-foreground">{$t('app.users.name')}</Label>
					<p class="text-sm font-medium">{user?.first_name} {user?.last_name}</p>
				</div>
				<div>
					<Label class="text-muted-foreground">{$t('app.users.email')}</Label>
					<p class="text-sm font-medium">{user?.email}</p>
				</div>
				<div>
					<Label class="text-muted-foreground">{$t('app.users.role')}</Label>
					<p class="text-sm font-medium">{user?.role?.name || '-'}</p>
				</div>
			</div>
		</Card.Content>
		<Card.Footer>
			<Button variant="outline" onclick={openProfileDialog}
				>{$t('app.account.edit_profile')}</Button
			>
		</Card.Footer>
	</Card.Root>

	<!-- Security -->
	<Card.Root>
		<Card.Header>
			<Card.Title>{$t('app.account.security')}</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="flex items-center justify-between">
				<div>
					<Label class="text-muted-foreground">{$t('app.auth.password')}</Label>
					<p class="text-sm">*************</p>
				</div>
			</div>
		</Card.Content>
		<Card.Footer>
			<Button variant="outline" onclick={openPasswordDialog}
				>{$t('app.account.change_password')}</Button
			>
		</Card.Footer>
	</Card.Root>
</div>

<!-- Profile Edit Dialog -->
<Dialog.Root bind:open={isProfileDialogOpen}>
	<Dialog.Content class="sm:max-w-[425px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.account.edit_profile')}</Dialog.Title>
			<Dialog.Description>{$t('app.account.edit_profile_desc')}</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/updateProfile"
			use:enhance={() => {
				isSubmitting = true;
				return async ({ update }) => {
					await update();
					isSubmitting = false;
				};
			}}
			class="grid gap-4 py-4"
		>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="first_name" class="text-right">{$t('app.setup.first_name')}</Label>
				<Input
					id="first_name"
					name="first_name"
					bind:value={profileFirstName}
					class="col-span-3"
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="last_name" class="text-right">{$t('app.setup.last_name')}</Label>
				<Input
					id="last_name"
					name="last_name"
					bind:value={profileLastName}
					class="col-span-3"
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="email" class="text-right">{$t('app.users.email')}</Label>
				<Input
					id="email"
					name="email"
					type="email"
					bind:value={profileEmail}
					class="col-span-3"
				/>
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={isSubmitting}>
					{#if isSubmitting}
						{$t('app.components.common.submitting')}
					{:else}
						{$t('app.components.common.save')}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Change Password Dialog -->
<Dialog.Root bind:open={isPasswordDialogOpen}>
	<Dialog.Content class="sm:max-w-[425px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.account.change_password')}</Dialog.Title>
			<Dialog.Description>{$t('app.account.change_password_desc')}</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="?/updatePassword"
			use:enhance={({ cancel }) => {
				if (newPassword !== confirmNewPassword) {
					setAlert({
						type: 'error',
						title: $t('app.search.error'),
						message: $t('app.account.passwords_do_not_match'),
						duration: 3000,
						show: true,
					});
					cancel();
					return;
				}
				isSubmitting = true;
				return async ({ update }) => {
					await update();
					isSubmitting = false;
				};
			}}
			class="grid gap-4 py-4"
		>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="currentPassword" class="text-right"
					>{$t('app.account.current_password')}</Label
				>
				<Input
					id="currentPassword"
					name="currentPassword"
					type="password"
					bind:value={currentPassword}
					class="col-span-3"
					required
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="newPassword" class="text-right">{$t('app.account.new_password')}</Label>
				<Input
					id="newPassword"
					name="newPassword"
					type="password"
					bind:value={newPassword}
					class="col-span-3"
					required
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="confirmNewPassword" class="text-right"
					>{$t('app.account.confirm_new_password')}</Label
				>
				<Input
					id="confirmNewPassword"
					type="password"
					bind:value={confirmNewPassword}
					class="col-span-3"
					required
				/>
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={isSubmitting}>
					{#if isSubmitting}
						{$t('app.components.common.submitting')}
					{:else}
						{$t('app.components.common.save')}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
