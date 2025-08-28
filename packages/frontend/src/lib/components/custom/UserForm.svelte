<script lang="ts">
	import type { User, Role } from '@open-archiver/types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import { t } from '$lib/translations';

	let {
		user = null,
		roles,
		onSubmit,
	}: {
		user?: User | null;
		roles: Role[];
		onSubmit: (data: any) => Promise<void>;
	} = $props();

	let formData = $state({
		first_name: user?.first_name ?? '',
		last_name: user?.last_name ?? '',
		email: user?.email ?? '',
		password: '',
		roleId: user?.role?.id ?? roles[0]?.id ?? '',
	});

	const triggerContent = $derived(
		roles.find((r) => r.id === formData.roleId)?.name ?? $t('components.user_form.select_role')
	);

	let isSubmitting = $state(false);

	const handleSubmit = async (event: Event) => {
		event.preventDefault();
		isSubmitting = true;
		try {
			const dataToSubmit: any = { ...formData };
			if (!user) {
				// only send password on create
				dataToSubmit.password = formData.password;
			} else {
				delete dataToSubmit.password;
			}
			if (dataToSubmit.password === '') {
				delete dataToSubmit.password;
			}
			await onSubmit(dataToSubmit);
		} finally {
			isSubmitting = false;
		}
	};
</script>

<form onsubmit={handleSubmit} class="grid gap-4 py-4">
	<div class="grid grid-cols-4 items-center gap-4">
		<Label for="first_name" class="text-left">{$t('setup.first_name')}</Label>
		<Input id="first_name" bind:value={formData.first_name} class="col-span-3" />
	</div>
	<div class="grid grid-cols-4 items-center gap-4">
		<Label for="last_name" class="text-left">{$t('setup.last_name')}</Label>
		<Input id="last_name" bind:value={formData.last_name} class="col-span-3" />
	</div>
	<div class="grid grid-cols-4 items-center gap-4">
		<Label for="email" class="text-left">{$t('users.email')}</Label>
		<Input id="email" type="email" bind:value={formData.email} class="col-span-3" />
	</div>
	{#if !user}
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="password" class="text-left">{$t('auth.password')}</Label>
			<Input
				id="password"
				type="password"
				bind:value={formData.password}
				class="col-span-3"
			/>
		</div>
	{/if}
	<div class="grid grid-cols-4 items-center gap-4">
		<Label for="role" class="text-left">{$t('users.role')}</Label>
		<Select.Root name="role" bind:value={formData.roleId} type="single">
			<Select.Trigger class="col-span-3">
				{triggerContent}
			</Select.Trigger>
			<Select.Content>
				{#each roles as role}
					<Select.Item value={role.id}>{role.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<Dialog.Footer>
		<Button type="submit" disabled={isSubmitting}>
			{#if isSubmitting}
				{$t('components.common.submitting')}
			{:else}
				{$t('components.common.submit')}
			{/if}
		</Button>
	</Dialog.Footer>
</form>
