<script lang="ts">
	import { t } from '$lib/translations';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';
	import { Plus, Info, Trash2 } from 'lucide-svelte';
	import tippy from 'tippy.js';
	import 'tippy.js/dist/tippy.css';
	import type {
		JournalingSource,
		OrganizationDomainGroup,
		SafeIngestionSource,
	} from '@open-archiver/types';

	interface Props {
		/** When set, form is in edit mode — fields are pre-populated from this source. */
		source?: JournalingSource | null;
		/** Available root ingestion sources for the merge-into dropdown. Only shown on create. */
		mergeableRootSources?: SafeIngestionSource[];
		isLoading?: boolean;
		onCancel: () => void;
	}

	let { source = null, mergeableRootSources = [], isLoading = false, onCancel }: Props = $props();

	const isEditMode = $derived(source !== null);

	// --- Allowed IPs ---
	let allowedIpsValue = $state(source ? source.allowedIps.join(', ') : '');

	// --- Domain groups ---
	let domainGroups = $state<OrganizationDomainGroup[]>(
		source
			? source.organizationDomains.map((g) => ({ main: g.main, aliases: [...g.aliases] }))
			: []
	);

	// --- TLS & Auth ---
	let requireTls = $state(source ? source.requireTls : true);

	// --- SMTP password change tracking (edit mode only) ---
	// Starts false so that leaving the password field blank keeps the existing hash.
	// Set to true as soon as the user types anything, signalling intent to change/clear.
	let smtpPasswordChanged = $state(false);

	// --- Preserve original file (create only) ---
	let preserveOriginalFile = $state(true);

	// --- Merge into (create only) ---
	let mergedIntoId = $state<string | undefined>(undefined);
	const mergeTriggerContent = $derived(
		mergedIntoId
			? (mergeableRootSources.find((s) => s.id === mergedIntoId)?.name ??
					$t('app.components.ingestion_source_form.merge_into_select'))
			: $t('app.components.ingestion_source_form.merge_into_select')
	);

	// --- Domain group helpers ---
	function addGroup() {
		domainGroups = [...domainGroups, { main: '', aliases: [] }];
	}

	function removeGroup(idx: number) {
		domainGroups = domainGroups.filter((_, i) => i !== idx);
	}

	function updateMain(idx: number, value: string) {
		domainGroups = domainGroups.map((g, i) => (i === idx ? { ...g, main: value } : g));
	}

	function updateAliases(idx: number, raw: string) {
		const aliases = raw
			.split(',')
			.map((d) => d.trim().toLowerCase())
			.filter(Boolean);
		domainGroups = domainGroups.map((g, i) => (i === idx ? { ...g, aliases } : g));
	}

	/** Serialized JSON value for the hidden form input. */
	const serializedDomains = $derived(
		JSON.stringify(
			domainGroups
				.filter((g) => g.main.trim().length > 0)
				.map((g) => ({ main: g.main.trim().toLowerCase(), aliases: g.aliases }))
		)
	);
</script>

<!--
	JournalingSourceForm — shared form body for create and edit journaling source dialogs.
	The parent is responsible for wrapping this in a <form> with the correct action.
	All fields use native form inputs so SvelteKit's use:enhance works as usual.
-->

{#if isEditMode && source}
	<input type="hidden" name="id" value={source.id} />
{/if}

<!-- Name -->
<div class="space-y-1.5">
	<Label for="js-name">{$t('app.journaling.name')}</Label>
	<Input
		id="js-name"
		name="name"
		required
		placeholder={$t('app.journaling.name_placeholder')}
		value={source?.name ?? ''}
	/>
</div>

<!-- Allowed IPs -->
<div class="space-y-1.5">
	<div class="flex items-center gap-1">
		<Label for="js-ips">{$t('app.journaling.allowed_ips')}</Label>
		<span
			use:tippy={{
				allowHTML: false,
				content: $t('app.journaling.allowed_ips_tooltip'),
				interactive: false,
				delay: 300,
			}}
			class="text-muted-foreground cursor-help"
		>
			<Info class="h-3.5 w-3.5" />
		</span>
	</div>
	<Input
		id="js-ips"
		name="allowedIps"
		required
		placeholder={$t('app.journaling.allowed_ips_placeholder')}
		bind:value={allowedIpsValue}
	/>
</div>

<!-- Organization Domain Groups -->
<div class="space-y-2">
	<div class="flex items-center gap-1">
		<Label>{$t('app.journaling.organization_domains')}</Label>
		<span
			use:tippy={{
				allowHTML: false,
				content: $t('app.journaling.organization_domains_tooltip'),
				interactive: false,
				delay: 300,
			}}
			class="text-muted-foreground cursor-help"
		>
			<Info class="h-3.5 w-3.5" />
		</span>
	</div>

	{#if domainGroups.length === 0}
		<p class="text-muted-foreground text-xs italic">
			{$t('app.journaling.no_domain_groups')}
		</p>
	{/if}

	{#each domainGroups as group, idx (idx)}
		<div class="bg-muted/30 space-y-2 rounded-md border p-3">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium">
					{$t('app.journaling.domain_group_primary')} #{idx + 1}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="text-destructive hover:text-destructive h-6 w-6"
					onclick={() => removeGroup(idx)}
				>
					<Trash2 class="h-3.5 w-3.5" />
				</Button>
			</div>
			<div class="space-y-1.5">
				<Label class="text-xs">{$t('app.journaling.domain_group_primary')}</Label>
				<Input
					class="h-8 text-sm"
					placeholder={$t('app.journaling.domain_group_primary_placeholder')}
					value={group.main}
					oninput={(e) => updateMain(idx, (e.target as HTMLInputElement).value)}
				/>
			</div>
			<div class="space-y-1.5">
				<Label class="text-xs">{$t('app.journaling.domain_group_aliases')}</Label>
				<Input
					class="h-8 text-sm"
					placeholder={$t('app.journaling.domain_group_aliases_placeholder')}
					value={group.aliases.join(', ')}
					oninput={(e) => updateAliases(idx, (e.target as HTMLInputElement).value)}
				/>
			</div>
		</div>
	{/each}

	<Button type="button" variant="outline" size="sm" class="h-7 text-xs" onclick={addGroup}>
		<Plus class="mr-1 h-3 w-3" />
		{$t('app.journaling.add_domain_group')}
	</Button>

	<!-- Hidden input carries the serialized JSON to the server action -->
	<input type="hidden" name="organizationDomains" value={serializedDomains} />
</div>

<!-- Require TLS -->
<div class="flex items-center gap-2">
	<input
		type="checkbox"
		id="js-tls"
		name="requireTls"
		class="h-4 w-4 rounded border"
		bind:checked={requireTls}
	/>
	<Label for="js-tls">{$t('app.journaling.require_tls')}</Label>
</div>

<!-- SMTP AUTH (optional) -->
<div class="space-y-3 rounded-md border p-3">
	<p class="text-muted-foreground text-xs font-medium">
		{$t('app.journaling.smtp_auth_hint')}
	</p>
	<div class="space-y-1.5">
		<Label for="js-username">{$t('app.journaling.smtp_username')}</Label>
		<Input
			id="js-username"
			name="smtpUsername"
			value={source?.smtpUsername ?? ''}
			placeholder={$t('app.journaling.smtp_username_placeholder')}
		/>
	</div>
	<div class="space-y-1.5">
		<Label for="js-password">{$t('app.journaling.smtp_password')}</Label>
		<Input
			id="js-password"
			name="smtpPassword"
			type="password"
			placeholder={isEditMode && source?.hasSmtpAuth
				? $t('app.journaling.smtp_password_set_placeholder')
				: $t('app.journaling.smtp_password_placeholder')}
			oninput={() => (smtpPasswordChanged = true)}
		/>
		{#if isEditMode && source?.hasSmtpAuth && !smtpPasswordChanged}
			<p class="text-muted-foreground text-xs">
				{$t('app.journaling.smtp_password_set_hint')}
			</p>
		{/if}
		{#if isEditMode && smtpPasswordChanged}
			<p class="text-muted-foreground text-xs">
				{$t('app.journaling.smtp_password_changed_hint')}
			</p>
		{/if}
	</div>
	<!-- Sentinel: tells the server action whether the user interacted with the password field -->
	<input
		type="hidden"
		name="smtpPasswordChanged"
		value={smtpPasswordChanged ? 'true' : 'false'}
	/>
</div>

{#if !isEditMode}
	<!-- Preserve Original File (create only) -->
	<div class="grid grid-cols-4 items-center gap-4">
		<div class="flex items-center gap-1 text-left">
			<Label for="js-preserve">
				{$t('app.components.ingestion_source_form.preserve_original_file')}
			</Label>
			<span
				use:tippy={{
					allowHTML: true,
					content: $t(
						'app.components.ingestion_source_form.preserve_original_file_tooltip'
					),
					interactive: true,
					delay: 500,
				}}
				class="text-muted-foreground cursor-help"
			>
				<Info class="h-4 w-4" />
			</span>
		</div>
		<Checkbox id="js-preserve" bind:checked={preserveOriginalFile} />
		<input
			type="hidden"
			name="preserveOriginalFile"
			value={preserveOriginalFile ? 'on' : 'off'}
		/>
	</div>

	<!-- Merge into existing ingestion (create only) -->
	{#if mergeableRootSources.length > 0}
		<div class="grid grid-cols-4 items-center gap-4">
			<div class="flex items-center gap-1 text-left">
				<Label for="js-merge">
					{$t('app.components.ingestion_source_form.merge_into')}
				</Label>
				<span
					use:tippy={{
						allowHTML: true,
						content: $t('app.components.ingestion_source_form.merge_into_tooltip'),
						interactive: true,
						delay: 500,
					}}
					class="text-muted-foreground cursor-help"
				>
					<Info class="h-4 w-4" />
				</span>
			</div>
			<div class="col-span-3">
				<Select.Root name="mergedIntoId" bind:value={mergedIntoId} type="single">
					<Select.Trigger class="w-full">
						{mergeTriggerContent}
					</Select.Trigger>
					<Select.Content>
						{#each mergeableRootSources as rootSource}
							<Select.Item value={rootSource.id}>
								{rootSource.name} ({rootSource.provider.split('_').join(' ')})
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if mergedIntoId}
					<input type="hidden" name="mergedIntoId" value={mergedIntoId} />
				{/if}
			</div>
		</div>
	{/if}
{/if}

<!-- Form action buttons -->
<div class="flex justify-end gap-2 pt-2">
	<Button type="button" variant="outline" onclick={onCancel} disabled={isLoading}>
		{$t('app.journaling.cancel')}
	</Button>
	<Button type="submit" disabled={isLoading}>
		{#if isLoading}
			{$t('app.common.working')}
		{:else if isEditMode}
			{$t('app.journaling.save')}
		{:else}
			{$t('app.journaling.create')}
		{/if}
	</Button>
</div>
