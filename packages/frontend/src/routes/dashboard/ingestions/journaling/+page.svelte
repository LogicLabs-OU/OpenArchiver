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
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { MoreHorizontal, Plus, Radio, Mail, Copy, Check, RefreshCw } from 'lucide-svelte';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import type { JournalingSource } from '@open-archiver/types';

	let { data }: { data: PageData; form: ActionData } = $props();

	let sources = $derived(data.sources);
	let smtpHealth = $derived(data.smtpHealth);

	// --- Dialog state ---
	let isCreateOpen = $state(false);
	let isEditOpen = $state(false);
	let isDeleteOpen = $state(false);
	let isRegenerateOpen = $state(false);

	let selectedSource = $state<JournalingSource | null>(null);
	let isFormLoading = $state(false);
	let copiedField = $state<string | null>(null);

	function openEdit(source: JournalingSource) {
		selectedSource = source;
		isEditOpen = true;
	}

	function openDelete(source: JournalingSource) {
		selectedSource = source;
		isDeleteOpen = true;
	}

	async function copyToClipboard(text: string, field: string) {
		await navigator.clipboard.writeText(text);
		copiedField = field;
		setTimeout(() => (copiedField = null), 2000);
	}

	/** Programmatically submit the regenerateAddress action (avoids nested <form>). */
	async function handleRegenerateAddress(sourceId: string) {
		isFormLoading = true;
		try {
			const formData = new FormData();
			formData.set('id', sourceId);

			const res = await fetch('?/regenerateAddress', {
				method: 'POST',
				body: formData,
			});
			const result = await res.json();
			// SvelteKit actions return { type, status, data } wrapped structure
			const data = result?.data;
			const success = Array.isArray(data)
				? data[0]?.success !== false
				: data?.success !== false;

			if (success) {
				setAlert({
					type: 'success',
					title: $t('app.journaling.regenerate_address_success'),
					message: '',
					duration: 5000,
					show: true,
				});
			} else {
				const msg = Array.isArray(data) ? data[0]?.message : data?.message;
				setAlert({
					type: 'error',
					title: $t('app.journaling.regenerate_address_error'),
					message: String(msg ?? ''),
					duration: 5000,
					show: true,
				});
			}
		} catch {
			setAlert({
				type: 'error',
				title: $t('app.journaling.regenerate_address_error'),
				message: '',
				duration: 5000,
				show: true,
			});
		} finally {
			isFormLoading = false;
			isEditOpen = false;
			selectedSource = null;
			// Re-run the load function to get updated data without a full page reload
			await invalidateAll();
		}
	}
</script>

<svelte:head>
	<title>{$t('app.journaling.title')} - Open Archiver</title>
	<meta name="description" content={$t('app.journaling.meta_description')} />
	<meta
		name="keywords"
		content="SMTP journaling, email archiving, journal reports, MTA integration, Exchange journaling, zero-gap archiving"
	/>
</svelte:head>

<div class="mb-6 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-bold">{$t('app.journaling.header')}</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			{$t('app.journaling.header_description')}
		</p>
	</div>
	<Button onclick={() => (isCreateOpen = true)}>
		<Plus class="mr-1.5 h-4 w-4" />
		{$t('app.journaling.create_new')}
	</Button>
</div>

<!-- SMTP Listener health badge -->
<div class="mb-4 flex items-center gap-3">
	<div class="flex items-center gap-2">
		<Radio
			class="h-4 w-4 {smtpHealth.smtp === 'listening'
				? 'text-green-500'
				: 'text-destructive'}"
		/>
		<span class="text-sm font-medium">
			{smtpHealth.smtp === 'listening'
				? $t('app.journaling.health_listening')
				: $t('app.journaling.health_down')}
		</span>
	</div>
	<Badge variant="outline" class="font-mono text-xs">
		{$t('app.journaling.smtp_port')}: {smtpHealth.port}
	</Badge>
</div>

<div class="rounded-md border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>{$t('app.journaling.name')}</Table.Head>
				<Table.Head>{$t('app.journaling.allowed_ips')}</Table.Head>
				<Table.Head>{$t('app.journaling.total_received')}</Table.Head>
				<Table.Head>{$t('app.journaling.status')}</Table.Head>
				<Table.Head>{$t('app.journaling.last_received_at')}</Table.Head>
				<Table.Head class="text-right">{$t('app.journaling.actions')}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if sources && sources.length > 0}
				{#each sources as source (source.id)}
					<Table.Row>
						<Table.Cell class="font-medium">
							<div>
								<div>{source.name}</div>
								<div class="mt-1 flex items-center gap-1">
									<code
										class="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]"
										>{source.routingAddress}</code
									>
									<button
										type="button"
										class="text-muted-foreground hover:text-foreground"
										onclick={() =>
											copyToClipboard(
												source.routingAddress,
												`route-${source.id}`
											)}
									>
										{#if copiedField === `route-${source.id}`}
											<Check class="h-3 w-3 text-green-500" />
										{:else}
											<Copy class="h-3 w-3" />
										{/if}
									</button>
								</div>
							</div>
						</Table.Cell>
						<Table.Cell>
							<div class="flex flex-wrap gap-1">
								{#each source.allowedIps.slice(0, 3) as ip}
									<Badge variant="outline" class="font-mono text-[10px]">
										{ip}
									</Badge>
								{/each}
								{#if source.allowedIps.length > 3}
									<Badge variant="secondary" class="text-[10px]">
										+{source.allowedIps.length - 3}
									</Badge>
								{/if}
							</div>
						</Table.Cell>
						<Table.Cell>
							<div class="flex items-center gap-1.5">
								<Mail class="text-muted-foreground h-3.5 w-3.5" />
								<Badge variant={source.totalReceived > 0 ? 'secondary' : 'outline'}>
									{source.totalReceived}
								</Badge>
							</div>
						</Table.Cell>
						<Table.Cell>
							{#if source.status === 'active'}
								<Badge class="bg-green-600 text-white">
									{$t('app.journaling.active')}
								</Badge>
							{:else}
								<Badge variant="secondary">
									{$t('app.journaling.paused')}
								</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell>
							{#if source.lastReceivedAt}
								{new Date(source.lastReceivedAt).toLocaleString()}
							{:else}
								<span class="text-muted-foreground text-xs italic">
									{$t('app.journaling.never')}
								</span>
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
									<DropdownMenu.Item onclick={() => openEdit(source)}>
										{$t('app.journaling.edit')}
									</DropdownMenu.Item>
									<!-- Toggle active/paused -->
									<form
										method="POST"
										action="?/toggleStatus"
										use:enhance={() => {
											return async ({ result, update }) => {
												if (result.type === 'success') {
													setAlert({
														type: 'success',
														title: $t('app.journaling.update_success'),
														message: '',
														duration: 3000,
														show: true,
													});
												} else if (result.type === 'failure') {
													setAlert({
														type: 'error',
														title: $t('app.journaling.update_error'),
														message: String(result.data?.message ?? ''),
														duration: 5000,
														show: true,
													});
												}
												await update();
											};
										}}
									>
										<input type="hidden" name="id" value={source.id} />
										<input
											type="hidden"
											name="status"
											value={source.status === 'active' ? 'paused' : 'active'}
										/>
										<DropdownMenu.Item>
											<button type="submit" class="w-full text-left">
												{source.status === 'active'
													? $t('app.journaling.pause')
													: $t('app.journaling.activate')}
											</button>
										</DropdownMenu.Item>
									</form>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										class="text-destructive focus:text-destructive"
										onclick={() => openDelete(source)}
									>
										{$t('app.journaling.delete')}
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</Table.Cell>
					</Table.Row>
				{/each}
			{:else}
				<Table.Row>
					<Table.Cell colspan={6} class="h-24 text-center">
						{$t('app.journaling.no_sources_found')}
					</Table.Cell>
				</Table.Row>
			{/if}
		</Table.Body>
	</Table.Root>
</div>

<!-- Create dialog -->
<Dialog.Root bind:open={isCreateOpen}>
	<Dialog.Content class="sm:max-w-[560px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.journaling.create')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.journaling.create_description')}
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
							title: $t('app.journaling.create_success'),
							message: '',
							duration: 3000,
							show: true,
						});
					} else if (result.type === 'failure') {
						setAlert({
							type: 'error',
							title: $t('app.journaling.create_error'),
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
				<Label for="create-name">{$t('app.journaling.name')}</Label>
				<Input
					id="create-name"
					name="name"
					required
					placeholder={$t('app.journaling.name_placeholder')}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="create-ips">{$t('app.journaling.allowed_ips')}</Label>
				<Input
					id="create-ips"
					name="allowedIps"
					required
					placeholder={$t('app.journaling.allowed_ips_placeholder')}
				/>
				<p class="text-muted-foreground text-xs">
					{$t('app.journaling.allowed_ips_hint')}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<input
					type="checkbox"
					id="create-tls"
					name="requireTls"
					class="h-4 w-4 rounded border"
					checked
				/>
				<Label for="create-tls">{$t('app.journaling.require_tls')}</Label>
			</div>
			<div class="space-y-3 rounded-md border p-3">
				<p class="text-muted-foreground text-xs font-medium">
					{$t('app.journaling.smtp_auth_hint')}
				</p>
				<div class="space-y-1.5">
					<Label for="create-username">{$t('app.journaling.smtp_username')}</Label>
					<Input
						id="create-username"
						name="smtpUsername"
						placeholder={$t('app.journaling.smtp_username_placeholder')}
					/>
				</div>
				<div class="space-y-1.5">
					<Label for="create-password">{$t('app.journaling.smtp_password')}</Label>
					<Input
						id="create-password"
						name="smtpPassword"
						type="password"
						placeholder={$t('app.journaling.smtp_password_placeholder')}
					/>
				</div>
			</div>
			<div class="flex justify-end gap-2">
				<Button
					type="button"
					variant="outline"
					onclick={() => (isCreateOpen = false)}
					disabled={isFormLoading}
				>
					{$t('app.journaling.cancel')}
				</Button>
				<Button type="submit" disabled={isFormLoading}>
					{#if isFormLoading}
						{$t('app.common.working')}
					{:else}
						{$t('app.journaling.create')}
					{/if}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- Edit dialog -->
<Dialog.Root bind:open={isEditOpen}>
	<Dialog.Content class="sm:max-w-[560px]">
		<Dialog.Header>
			<Dialog.Title>{$t('app.journaling.edit')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.journaling.edit_description')}
			</Dialog.Description>
		</Dialog.Header>
		{#if selectedSource}
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
							selectedSource = null;
							setAlert({
								type: 'success',
								title: $t('app.journaling.update_success'),
								message: '',
								duration: 3000,
								show: true,
							});
						} else if (result.type === 'failure') {
							setAlert({
								type: 'error',
								title: $t('app.journaling.update_error'),
								message: String(result.data?.message ?? ''),
								duration: 5000,
								show: true,
							});
						}
						await update();
					};
				}}
			>
				<input type="hidden" name="id" value={selectedSource.id} />

				<!-- SMTP Connection Info (read-only) -->
				<div class="bg-muted/30 rounded-md border p-3">
					<p class="mb-2 text-xs font-medium">
						{$t('app.journaling.smtp_connection_info')}
					</p>

					<!-- Routing Address (most important) -->
					<div class="mb-3">
						<span class="text-muted-foreground text-[10px]"
							>{$t('app.journaling.routing_address')}</span
						>
						<div class="mt-0.5 flex items-center gap-1.5">
							<code class="bg-muted rounded px-2 py-1 font-mono text-sm font-medium"
								>{selectedSource.routingAddress}</code
							>
							<button
								type="button"
								class="text-muted-foreground hover:text-foreground"
								onclick={() =>
									copyToClipboard(
										selectedSource?.routingAddress ?? '',
										'routing'
									)}
							>
								{#if copiedField === 'routing'}
									<Check class="h-3.5 w-3.5 text-green-500" />
								{:else}
									<Copy class="h-3.5 w-3.5" />
								{/if}
							</button>
						</div>
						<p class="text-muted-foreground mt-1 text-[10px]">
							{$t('app.journaling.routing_address_hint')}
						</p>
						<!-- Regenerate address — opens confirmation dialog -->
						<div class="mt-2 flex items-start gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="h-7 text-[11px]"
								disabled={isFormLoading}
								onclick={() => (isRegenerateOpen = true)}
							>
								<RefreshCw class="mr-1 h-3 w-3" />
								{$t('app.journaling.regenerate_address')}
							</Button>
							<p class="text-destructive flex-1 text-[10px] leading-tight">
								{$t('app.journaling.regenerate_address_warning')}
							</p>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-2">
						<div>
							<span class="text-muted-foreground text-[10px]"
								>{$t('app.journaling.smtp_host')}</span
							>
							<div class="flex items-center gap-1">
								<code class="text-xs"
									>{typeof window !== 'undefined'
										? window.location.hostname
										: 'localhost'}</code
								>
								<button
									type="button"
									class="text-muted-foreground hover:text-foreground"
									onclick={() =>
										copyToClipboard(
											typeof window !== 'undefined'
												? window.location.hostname
												: 'localhost',
											'host'
										)}
								>
									{#if copiedField === 'host'}
										<Check class="h-3 w-3 text-green-500" />
									{:else}
										<Copy class="h-3 w-3" />
									{/if}
								</button>
							</div>
						</div>
						<div>
							<span class="text-muted-foreground text-[10px]"
								>{$t('app.journaling.smtp_port')}</span
							>
							<div class="flex items-center gap-1">
								<code class="text-xs">{smtpHealth.port}</code>
								<button
									type="button"
									class="text-muted-foreground hover:text-foreground"
									onclick={() => copyToClipboard(smtpHealth.port, 'port')}
								>
									{#if copiedField === 'port'}
										<Check class="h-3 w-3 text-green-500" />
									{:else}
										<Copy class="h-3 w-3" />
									{/if}
								</button>
							</div>
						</div>
					</div>
				</div>

				<div class="space-y-1.5">
					<Label for="edit-name">{$t('app.journaling.name')}</Label>
					<Input id="edit-name" name="name" required value={selectedSource.name} />
				</div>
				<div class="space-y-1.5">
					<Label for="edit-ips">{$t('app.journaling.allowed_ips')}</Label>
					<Input
						id="edit-ips"
						name="allowedIps"
						required
						value={selectedSource.allowedIps.join(', ')}
					/>
					<p class="text-muted-foreground text-xs">
						{$t('app.journaling.allowed_ips_hint')}
					</p>
				</div>
				<div class="flex items-center gap-2">
					<input
						type="checkbox"
						id="edit-tls"
						name="requireTls"
						class="h-4 w-4 rounded border"
						checked={selectedSource.requireTls}
					/>
					<Label for="edit-tls">{$t('app.journaling.require_tls')}</Label>
				</div>
				<div class="space-y-3 rounded-md border p-3">
					<p class="text-muted-foreground text-xs font-medium">
						{$t('app.journaling.smtp_auth_hint')}
					</p>
					<div class="space-y-1.5">
						<Label for="edit-username">{$t('app.journaling.smtp_username')}</Label>
						<Input
							id="edit-username"
							name="smtpUsername"
							value={selectedSource.smtpUsername ?? ''}
							placeholder={$t('app.journaling.smtp_username_placeholder')}
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="edit-password">{$t('app.journaling.smtp_password')}</Label>
						<Input
							id="edit-password"
							name="smtpPassword"
							type="password"
							placeholder={$t('app.journaling.smtp_password_placeholder')}
						/>
					</div>
				</div>
				<div class="flex justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						onclick={() => (isEditOpen = false)}
						disabled={isFormLoading}
					>
						{$t('app.journaling.cancel')}
					</Button>
					<Button type="submit" disabled={isFormLoading}>
						{#if isFormLoading}
							{$t('app.common.working')}
						{:else}
							{$t('app.journaling.save')}
						{/if}
					</Button>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Delete confirmation dialog -->
<Dialog.Root bind:open={isDeleteOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$t('app.journaling.delete_confirmation_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.journaling.delete_confirmation_description')}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => (isDeleteOpen = false)}
				disabled={isFormLoading}
			>
				{$t('app.journaling.cancel')}
			</Button>
			{#if selectedSource}
				<form
					method="POST"
					action="?/delete"
					use:enhance={() => {
						isFormLoading = true;
						return async ({ result, update }) => {
							isFormLoading = false;
							if (result.type === 'success') {
								isDeleteOpen = false;
								setAlert({
									type: 'success',
									title: $t('app.journaling.delete_success'),
									message: '',
									duration: 3000,
									show: true,
								});
								selectedSource = null;
							} else if (result.type === 'failure') {
								setAlert({
									type: 'error',
									title: $t('app.journaling.delete_error'),
									message: String(result.data?.message ?? ''),
									duration: 5000,
									show: true,
								});
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="id" value={selectedSource.id} />
					<Button type="submit" variant="destructive" disabled={isFormLoading}>
						{#if isFormLoading}
							{$t('app.journaling.deleting')}
						{:else}
							{$t('app.journaling.confirm')}
						{/if}
					</Button>
				</form>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Regenerate address confirmation dialog -->
<Dialog.Root bind:open={isRegenerateOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$t('app.journaling.regenerate_address')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.journaling.regenerate_address_confirm')}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => (isRegenerateOpen = false)}
				disabled={isFormLoading}
			>
				{$t('app.journaling.cancel')}
			</Button>
			<Button
				variant="destructive"
				disabled={isFormLoading}
				onclick={() => {
					isRegenerateOpen = false;
					handleRegenerateAddress(selectedSource?.id ?? '');
				}}
			>
				{#if isFormLoading}
					{$t('app.common.working')}
				{:else}
					{$t('app.journaling.regenerate_address')}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
