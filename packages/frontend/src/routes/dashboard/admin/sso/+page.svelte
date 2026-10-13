<script lang="ts">
	import { api } from '$lib/api.client';
	import { t } from '$lib/translations';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import ChipInput from '$lib/components/search/ChipInput.svelte';
	import * as Table from '$lib/components/ui/table';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import EmptyState from '$lib/components/custom/EmptyState.svelte';
	import { Trash2, Plus, Copy, ArrowLeft, Pencil } from 'lucide-svelte';
	import { format } from 'date-fns';
	import type { SsoConnectionTestResult, SsoGroupMapping } from '@open-archiver/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * Which connection the page is showing.
	 *
	 * `null` is the list, `'new'` is a blank form, and an id edits that connection.
	 * Several connections can run at once — a browser button each on the sign-in
	 * page — so the page is a list first and a form second.
	 */
	let selectedId = $state<string | 'new' | null>(null);

	const existing = $derived(
		selectedId && selectedId !== 'new'
			? (data.connections.find((c) => c.id === selectedId) ?? null)
			: null
	);

	let name = $state('');
	let protocol = $state<'oidc' | 'saml'>('oidc');
	let issuer = $state('');
	let samlIdpMetadata = $state('');
	let clientId = $state('');
	let clientSecret = $state('');
	let emailDomains = $state<string[]>([]);
	let enabled = $state(false);
	let jitEnabled = $state(true);
	let autoLink = $state(true);
	let syncRolesOnLogin = $state(true);
	let groupsClaim = $state('groups');
	let defaultRoleId = $state<string | null>(null);
	let groupMappings = $state<SsoGroupMapping[]>([]);
	let enforceSso = $state(false);

	let isSaving = $state(false);
	let isTesting = $state(false);
	let testResult = $state<SsoConnectionTestResult | null>(null);
	let enforceDialogOpen = $state(false);
	let deleteDialogOpen = $state(false);

	/**
	 * Enforcement stays unavailable until a real sign-in has completed through this
	 * connection. Turning it on before then would be the one mistake with no way
	 * back through the interface.
	 */
	const canEnforce = $derived(Boolean(existing?.enabled && existing?.lastSuccessfulLoginAt));

	const defaultRoleLabel = $derived(
		data.roles.find((r) => r.id === defaultRoleId)?.name ?? $t('app.sso.no_default_role')
	);

	// Reload local state whenever the selection or the server data changes —
	// including after a save, and when switching to the blank 'new' form.
	$effect(() => {
		// Read so the effect re-runs on a switch to 'new', where `existing` is null
		// both before and after and would not by itself signal a change.
		void selectedId;
		const c = existing;
		name = c?.name ?? '';
		protocol = c?.protocol ?? 'oidc';
		issuer = c?.issuer ?? '';
		samlIdpMetadata = c?.samlIdpMetadata ?? '';
		clientId = c?.clientId ?? '';
		clientSecret = '';
		emailDomains = c?.emailDomains ? [...c.emailDomains] : [];
		enabled = c?.enabled ?? false;
		jitEnabled = c?.jitEnabled ?? true;
		autoLink = c?.autoLink ?? true;
		syncRolesOnLogin = c?.syncRolesOnLogin ?? true;
		groupsClaim = c?.groupsClaim ?? 'groups';
		defaultRoleId = c?.defaultRoleId ?? null;
		groupMappings = c?.groupMappings ? [...c.groupMappings] : [];
		enforceSso = c?.enforceSso ?? false;
	});

	function addMapping() {
		groupMappings = [...groupMappings, { group: '', roleId: data.roles[0]?.id ?? '' }];
	}

	function removeMapping(index: number) {
		groupMappings = groupMappings.filter((_, i) => i !== index);
	}

	async function copyRedirectUri() {
		try {
			await navigator.clipboard.writeText(data.redirectUri);
			setAlert({
				type: 'success',
				title: $t('app.sso.redirect_copied'),
				message: data.redirectUri,
				duration: 3000,
				show: true,
			});
		} catch {
			// Clipboard access can be refused; the value is visible on screen anyway.
		}
	}

	function buildPayload() {
		return {
			name,
			protocol,
			enabled,
			issuer,
			// OIDC credentials and SAML metadata are mutually exclusive; the ones
			// belonging to the other protocol are cleared rather than left behind.
			clientId: protocol === 'oidc' && clientId ? clientId : null,
			// Omitted when blank, which the API reads as "leave the stored secret alone".
			...(protocol === 'oidc' && clientSecret ? { clientSecret } : {}),
			samlIdpMetadata: protocol === 'saml' && samlIdpMetadata ? samlIdpMetadata : null,
			emailDomains,
			jitEnabled,
			autoLink,
			defaultRoleId,
			groupsClaim,
			groupMappings: groupMappings.filter((m) => m.group.trim() && m.roleId),
			syncRolesOnLogin,
		};
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (emailDomains.length === 0) {
			setAlert({
				type: 'error',
				title: $t('app.sso.save_failed'),
				message: $t('app.sso.domains_required'),
				duration: 5000,
				show: true,
			});
			return;
		}

		isSaving = true;
		try {
			const res = existing
				? await api(`/enterprise/sso/connections/${existing.id}`, {
						method: 'PUT',
						body: JSON.stringify(buildPayload()),
					})
				: await api('/enterprise/sso/connections', {
						method: 'POST',
						body: JSON.stringify(buildPayload()),
					});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || $t('app.sso.save_failed'));
			}

			// A newly created connection: follow it, so the page shows the saved
			// record — with its Test button and enforcement switch — instead of a
			// form that still looks unsaved.
			if (!existing) {
				const created = await res.json().catch(() => null);
				if (created?.id) selectedId = created.id;
			}

			setAlert({
				type: 'success',
				title: $t('app.sso.saved'),
				message: $t('app.sso.saved_desc'),
				duration: 4000,
				show: true,
			});
			await invalidateAll();
		} catch (err: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.sso.save_failed'),
				message: err instanceof Error ? err.message : String(err),
				duration: 5000,
				show: true,
			});
		} finally {
			isSaving = false;
		}
	}

	async function runTest() {
		if (!existing) return;
		isTesting = true;
		testResult = null;
		try {
			const res = await api(`/enterprise/sso/connections/${existing.id}/test`, {
				method: 'POST',
			});
			testResult = await res.json();
		} catch (err: unknown) {
			testResult = {
				ok: false,
				message: err instanceof Error ? err.message : String(err),
			};
		} finally {
			isTesting = false;
		}
	}

	/** Enforcement is saved on its own, behind a confirmation, never with the rest of the form. */
	async function confirmEnforce(next: boolean) {
		if (!existing) return;
		try {
			const res = await api(`/enterprise/sso/connections/${existing.id}`, {
				method: 'PUT',
				body: JSON.stringify({ enforceSso: next }),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.message || $t('app.sso.save_failed'));
			}
			enforceDialogOpen = false;
			await invalidateAll();
		} catch (err: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.sso.save_failed'),
				message: err instanceof Error ? err.message : String(err),
				duration: 5000,
				show: true,
			});
		}
	}

	async function deleteConnection() {
		if (!existing) return;
		try {
			const res = await api(`/enterprise/sso/connections/${existing.id}`, {
				method: 'DELETE',
			});
			if (!res.ok) throw new Error($t('app.sso.delete_failed'));
			deleteDialogOpen = false;
			selectedId = null;
			await invalidateAll();
		} catch (err: unknown) {
			setAlert({
				type: 'error',
				title: $t('app.sso.delete_failed'),
				message: err instanceof Error ? err.message : String(err),
				duration: 5000,
				show: true,
			});
		}
	}
</script>

<svelte:head>
	<title>{$t('app.sso.admin_title')} - Open Archiver</title>
	<meta
		name="description"
		content="Configure OpenID Connect single sign-on in Open Archiver Enterprise."
	/>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">{$t('app.sso.admin_title')}</h1>
		<p class="text-muted-foreground">{$t('app.sso.admin_description')}</p>
	</div>

	{#if selectedId === null}
		<!-- ── List ─────────────────────────────────────────────────────────────
	     Every enabled connection becomes its own button on the sign-in page, so
	     an instance may run several at once — one identity provider for staff
	     and another for a partner organisation, say. -->
		<div class="flex items-center justify-end">
			<Button type="button" onclick={() => (selectedId = 'new')}>
				<Plus class="mr-1 h-4 w-4" />
				{$t('app.sso.add_connection')}
			</Button>
		</div>

		{#if data.connections.length === 0}
			<EmptyState
				header={$t('app.sso.empty_title')}
				text={$t('app.sso.empty_description')}
				buttonText={$t('app.sso.add_connection')}
				click={() => (selectedId = 'new')}
			/>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>{$t('app.sso.col_name')}</Table.Head>
						<Table.Head>{$t('app.sso.col_status')}</Table.Head>
						<Table.Head>{$t('app.sso.col_domains')}</Table.Head>
						<Table.Head>{$t('app.sso.col_last_login')}</Table.Head>
						<Table.Head class="text-right">{$t('app.sso.col_actions')}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.connections as connection (connection.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{connection.name}</div>
								<div class="text-muted-foreground text-xs uppercase">
									{connection.protocol}
								</div>
							</Table.Cell>
							<Table.Cell>
								<div class="flex flex-wrap gap-1">
									<Badge variant={connection.enabled ? 'default' : 'secondary'}>
										{connection.enabled
											? $t('app.sso.status_enabled')
											: $t('app.sso.status_disabled')}
									</Badge>
									{#if connection.enforceSso}
										<Badge variant="outline">
											{$t('app.sso.requires_sso_badge')}
										</Badge>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell>
								<div class="flex flex-wrap gap-1">
									{#each connection.emailDomains as domain (domain)}
										<Badge variant="secondary" class="font-normal"
											>{domain}</Badge
										>
									{/each}
								</div>
							</Table.Cell>
							<Table.Cell class="text-sm">
								{connection.lastSuccessfulLoginAt
									? format(new Date(connection.lastSuccessfulLoginAt), 'PPp')
									: $t('app.sso.never_signed_in')}
							</Table.Cell>
							<Table.Cell class="text-right">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button {...props} variant="ghost" size="sm">⋯</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										<DropdownMenu.Item
											onclick={() => (selectedId = connection.id)}
										>
											<Pencil class="mr-2 h-4 w-4" />
											{$t('app.sso.edit_button')}
										</DropdownMenu.Item>
										<DropdownMenu.Item
											onclick={() => {
												selectedId = connection.id;
												deleteDialogOpen = true;
											}}
										>
											<Trash2 class="mr-2 h-4 w-4" />
											{$t('app.sso.delete_button')}
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	{:else}
		<!-- ── Form ─────────────────────────────────────────────────────────── -->
		<div class="flex items-center gap-2">
			<Button type="button" variant="ghost" size="sm" onclick={() => (selectedId = null)}>
				<ArrowLeft class="mr-1 h-4 w-4" />
				{$t('app.sso.all_connections')}
			</Button>
			<span class="text-muted-foreground text-sm">
				{existing ? existing.name : $t('app.sso.new_connection')}
			</span>
		</div>

		<form onsubmit={save} class="space-y-6">
			<Card.Root>
				<Card.Header>
					<Card.Title>{$t('app.sso.provider_title')}</Card.Title>
					<Card.Description>{$t('app.sso.provider_description')}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="grid gap-2">
						<Label for="protocol">{$t('app.sso.protocol_label')}</Label>
						<p class="text-muted-foreground text-sm">{$t('app.sso.protocol_desc')}</p>
						<select
							id="protocol"
							bind:value={protocol}
							class="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
						>
							<option value="oidc">{$t('app.sso.protocol_oidc')}</option>
							<option value="saml">{$t('app.sso.protocol_saml')}</option>
						</select>
					</div>

					{#if protocol === 'oidc'}
						<div class="grid gap-2">
							<Label for="redirectUri">{$t('app.sso.redirect_uri_label')}</Label>
							<p class="text-muted-foreground text-sm">
								{$t('app.sso.redirect_uri_desc')}
							</p>
							<div class="flex items-center gap-2">
								<Input
									id="redirectUri"
									value={data.redirectUri}
									readonly
									class="font-mono text-xs"
								/>
								<Button
									type="button"
									variant="outline"
									size="icon"
									onclick={copyRedirectUri}
								>
									<Copy class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{:else}
						<!-- The two SP values an IdP console asks for. Most consoles accept the
					     metadata URL alone and read the ACS out of it. -->
						<div class="grid gap-2">
							<Label for="spMetadataUrl">{$t('app.sso.sp_metadata_label')}</Label>
							<p class="text-muted-foreground text-sm">
								{$t('app.sso.sp_metadata_desc')}
							</p>
							<Input
								id="spMetadataUrl"
								value={data.samlMetadataUrl}
								readonly
								class="font-mono text-xs"
							/>
						</div>
						<div class="grid gap-2">
							<Label for="spAcsUrl">{$t('app.sso.sp_acs_label')}</Label>
							<p class="text-muted-foreground text-sm">{$t('app.sso.sp_acs_desc')}</p>
							<Input
								id="spAcsUrl"
								value={data.samlAcsUrl}
								readonly
								class="font-mono text-xs"
							/>
						</div>
					{/if}

					<div class="grid gap-2">
						<Label for="name">{$t('app.sso.name_label')}</Label>
						<p class="text-muted-foreground text-sm">{$t('app.sso.name_desc')}</p>
						<Input id="name" bind:value={name} placeholder="Okta" required />
					</div>

					<div class="grid gap-2">
						<Label for="issuer">
							{protocol === 'saml'
								? $t('app.sso.saml_issuer_label')
								: $t('app.sso.issuer_label')}
						</Label>
						<p class="text-muted-foreground text-sm">
							{protocol === 'saml'
								? $t('app.sso.saml_issuer_desc')
								: $t('app.sso.issuer_desc')}
						</p>
						<Input
							id="issuer"
							bind:value={issuer}
							placeholder={protocol === 'saml'
								? 'https://id.example.com/realms/main/protocol/saml/descriptor'
								: 'https://id.example.com/realms/main'}
							required
						/>
					</div>

					{#if protocol === 'oidc'}
						<div class="grid gap-2">
							<Label for="clientId">{$t('app.sso.client_id_label')}</Label>
							<Input id="clientId" bind:value={clientId} required />
						</div>

						<div class="grid gap-2">
							<Label for="clientSecret">{$t('app.sso.client_secret_label')}</Label>
							<p class="text-muted-foreground text-sm">
								{existing?.hasClientSecret
									? $t('app.sso.client_secret_stored')
									: $t('app.sso.client_secret_desc')}
							</p>
							<Input
								id="clientSecret"
								type="password"
								bind:value={clientSecret}
								autocomplete="new-password"
								placeholder={existing?.hasClientSecret ? '••••••••' : ''}
							/>
						</div>
					{:else}
						<div class="grid gap-2">
							<Label for="samlIdpMetadata">{$t('app.sso.saml_metadata_label')}</Label>
							<p class="text-muted-foreground text-sm">
								{$t('app.sso.saml_metadata_desc')}
							</p>
							<Textarea
								id="samlIdpMetadata"
								bind:value={samlIdpMetadata}
								rows={6}
								class="font-mono text-xs"
								placeholder="<md:EntityDescriptor …"
							/>
							<p class="text-muted-foreground text-sm italic">
								{$t('app.sso.saml_unsigned_note')}
							</p>
						</div>
					{/if}

					<div class="flex items-center justify-between">
						<div>
							<Label>{$t('app.sso.enabled_label')}</Label>
							<p class="text-muted-foreground mt-1 text-sm">
								{$t('app.sso.enabled_desc')}
							</p>
						</div>
						<Switch bind:checked={enabled} />
					</div>

					{#if existing}
						<div class="flex items-center gap-3">
							<Button
								type="button"
								variant="outline"
								onclick={runTest}
								disabled={isTesting}
							>
								{isTesting ? $t('app.common.working') : $t('app.sso.test_button')}
							</Button>
							{#if testResult}
								<span
									class="text-sm {testResult.ok
										? 'text-green-600 dark:text-green-500'
										: 'text-destructive'}"
								>
									{testResult.message}
								</span>
							{/if}
						</div>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title>{$t('app.sso.accounts_title')}</Card.Title>
					<Card.Description>{$t('app.sso.accounts_description')}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="grid gap-2">
						<Label for="emailDomains">{$t('app.sso.domains_label')}</Label>
						<p class="text-muted-foreground text-sm">{$t('app.sso.domains_desc')}</p>
						<ChipInput
							id="emailDomains"
							bind:values={emailDomains}
							placeholder="example.com"
							commitOnBlur
						/>
					</div>

					<div class="flex items-center justify-between">
						<div>
							<Label>{$t('app.sso.jit_label')}</Label>
							<p class="text-muted-foreground mt-1 text-sm">
								{$t('app.sso.jit_desc')}
							</p>
						</div>
						<Switch bind:checked={jitEnabled} />
					</div>

					<div class="flex items-center justify-between">
						<div>
							<Label>{$t('app.sso.auto_link_label')}</Label>
							<p class="text-muted-foreground mt-1 text-sm">
								{$t('app.sso.auto_link_desc')}
							</p>
						</div>
						<Switch bind:checked={autoLink} />
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title>{$t('app.sso.roles_title')}</Card.Title>
					<Card.Description>{$t('app.sso.roles_description')}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="grid gap-2">
						<Label for="groupsClaim">{$t('app.sso.groups_claim_label')}</Label>
						<p class="text-muted-foreground text-sm">
							{$t('app.sso.groups_claim_desc')}
						</p>
						<Input id="groupsClaim" bind:value={groupsClaim} placeholder="groups" />
					</div>

					<div class="grid gap-2">
						<Label>{$t('app.sso.default_role_label')}</Label>
						<p class="text-muted-foreground text-sm">
							{$t('app.sso.default_role_desc')}
						</p>
						<Select.Root
							type="single"
							bind:value={
								() => defaultRoleId ?? '', (v) => (defaultRoleId = v || null)
							}
						>
							<Select.Trigger class="w-full">{defaultRoleLabel}</Select.Trigger>
							<Select.Content>
								<Select.Item value="">{$t('app.sso.no_default_role')}</Select.Item>
								{#each data.roles as role (role.id)}
									<Select.Item value={role.id}>{role.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<div class="space-y-2">
						<Label>{$t('app.sso.mappings_label')}</Label>
						<p class="text-muted-foreground text-sm">{$t('app.sso.mappings_desc')}</p>
						{#each groupMappings as mapping, i (i)}
							<div class="flex items-center gap-2">
								<Input
									bind:value={groupMappings[i].group}
									placeholder={$t('app.sso.group_placeholder')}
									class="flex-1"
								/>
								<span class="text-muted-foreground text-sm">→</span>
								<select
									bind:value={groupMappings[i].roleId}
									class="border-input bg-background h-9 flex-1 rounded-md border px-3 text-sm"
								>
									{#each data.roles as role (role.id)}
										<option value={role.id}>{role.name}</option>
									{/each}
								</select>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onclick={() => removeMapping(i)}
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						{/each}
						<Button type="button" variant="outline" size="sm" onclick={addMapping}>
							<Plus class="mr-1 h-4 w-4" />
							{$t('app.sso.add_mapping')}
						</Button>
					</div>

					<div class="flex items-center justify-between">
						<div>
							<Label>{$t('app.sso.sync_roles_label')}</Label>
							<p class="text-muted-foreground mt-1 text-sm">
								{$t('app.sso.sync_roles_desc')}
							</p>
						</div>
						<Switch bind:checked={syncRolesOnLogin} />
					</div>
				</Card.Content>
			</Card.Root>

			<div class="flex items-center justify-between">
				{#if existing}
					<!-- Opens a confirmation first: deletion destroys the IdP configuration,
				     the stored secret and the enforcement-unlock stamp in one click. -->
					<Button
						type="button"
						variant="outline"
						onclick={() => (deleteDialogOpen = true)}
					>
						<Trash2 class="mr-1 h-4 w-4" />
						{$t('app.sso.delete_button')}
					</Button>
				{:else}
					<span></span>
				{/if}
				<Button type="submit" disabled={isSaving}>
					{isSaving ? $t('app.common.working') : $t('app.components.common.save')}
				</Button>
			</div>
		</form>

		{#if existing}
			<Card.Root>
				<Card.Header>
					<Card.Title>{$t('app.sso.enforcement_title')}</Card.Title>
					<Card.Description>{$t('app.sso.enforcement_description')}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="flex items-center justify-between">
						<div class="pr-4">
							<Label>{$t('app.sso.enforce_label')}</Label>
							<p class="text-muted-foreground mt-1 text-sm">
								{$t('app.sso.enforce_desc')}
							</p>
							{#if !canEnforce}
								<p class="text-muted-foreground mt-2 text-sm italic">
									{$t('app.sso.enforce_locked')}
								</p>
							{:else if existing.lastSuccessfulLoginAt}
								<p class="text-muted-foreground mt-2 text-sm">
									{$t('app.sso.last_login')}:
									<span class="text-foreground font-medium">
										{format(new Date(existing.lastSuccessfulLoginAt), 'PPP')}
									</span>
								</p>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							{#if enforceSso}
								<Badge variant="secondary">{$t('app.sso.enforced_badge')}</Badge>
							{/if}
							<Switch
								checked={enforceSso}
								disabled={!canEnforce}
								onCheckedChange={(next) => {
									if (next) {
										enforceDialogOpen = true;
									} else {
										confirmEnforce(false);
									}
								}}
							/>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>

<Dialog.Root bind:open={enforceDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$t('app.sso.enforce_confirm_title')}</Dialog.Title>
			<Dialog.Description>
				{$t('app.sso.enforce_confirm_body')}
			</Dialog.Description>
			<!-- Named explicitly: with several connections configured, an unqualified
			     "require SSO" reads as an instance-wide switch when it is not. -->
			{#if existing}
				<p class="text-muted-foreground text-sm">
					{$t('app.sso.enforce_confirm_scope', {
						name: existing.name,
						domains: existing.emailDomains.join(', '),
					} as any)}
				</p>
			{/if}
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (enforceDialogOpen = false)}>
				{$t('app.components.common.cancel')}
			</Button>
			<Button onclick={() => confirmEnforce(true)}>
				{$t('app.sso.enforce_confirm_action')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>
				{existing
					? $t('app.sso.delete_confirm_title_named', { name: existing.name } as any)
					: $t('app.sso.delete_confirm_title')}
			</Dialog.Title>
			<Dialog.Description>{$t('app.sso.delete_confirm_body')}</Dialog.Description>
		</Dialog.Header>
		{#if existing && existing.boundUserCount > 0}
			<!-- What deletion actually does to people, stated before it happens: the
			     accounts return to password sign-in, and any provisioned by this
			     connection have no password to return to. -->
			<div class="space-y-2 text-sm">
				<p>
					{$t('app.sso.delete_confirm_bound', {
						count: existing.boundUserCount,
					} as any)}
				</p>
				{#if existing.passwordlessUserCount > 0}
					<p class="text-destructive">
						{$t('app.sso.delete_confirm_passwordless', {
							count: existing.passwordlessUserCount,
						} as any)}
					</p>
				{/if}
			</div>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (deleteDialogOpen = false)}>
				{$t('app.components.common.cancel')}
			</Button>
			<Button variant="destructive" onclick={deleteConnection}>
				{$t('app.sso.delete_confirm_action')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
