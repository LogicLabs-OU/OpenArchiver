<script lang="ts">
	import { t } from '$lib/translations';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';
	import { Info } from 'lucide-svelte';
	import OrganizationDomainGroupsEditor from './OrganizationDomainGroupsEditor.svelte';
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

	<OrganizationDomainGroupsEditor bind:groups={domainGroups} name="organizationDomains" />
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
