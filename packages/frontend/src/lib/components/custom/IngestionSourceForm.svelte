<script lang="ts">
	import type { IngestionSource, CreateIngestionSourceDto } from '@open-archiver/types';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { api } from '$lib/api.client';
	import { Loader2 } from 'lucide-svelte';
	import { t } from '$lib/translations';
	let {
		source = null,
		onSubmit,
	}: {
		source?: IngestionSource | null;
		onSubmit: (data: CreateIngestionSourceDto) => Promise<void>;
	} = $props();

	const providerOptions = [
		{
			value: 'generic_imap',
			label: $t('app.components.ingestion_source_form.provider_generic_imap'),
		},
		{
			value: 'google_workspace',
			label: $t('app.components.ingestion_source_form.provider_google_workspace'),
		},
		{
			value: 'microsoft_365',
			label: $t('app.components.ingestion_source_form.provider_microsoft_365'),
		},
		{
			value: 'pst_import',
			label: $t('app.components.ingestion_source_form.provider_pst_import'),
		},
		{
			value: 'eml_import',
			label: $t('app.components.ingestion_source_form.provider_eml_import'),
		},
		{
			value: 'mbox_import',
			label: $t('app.components.ingestion_source_form.provider_mbox_import'),
		},
	];

	let formData: CreateIngestionSourceDto = $state({
		name: source?.name ?? '',
		provider: source?.provider ?? 'generic_imap',
		providerConfig: source?.credentials ?? {
			type: source?.provider ?? 'generic_imap',
			secure: true,
			allowInsecureCert: false,
		},
	});

	$effect(() => {
		formData.providerConfig.type = formData.provider;
	});

	const triggerContent = $derived(
		providerOptions.find((p) => p.value === formData.provider)?.label ??
			$t('app.components.ingestion_source_form.select_provider')
	);

	let isSubmitting = $state(false);

	let fileUploading = $state(false);

	const handleSubmit = async (event: Event) => {
		event.preventDefault();
		isSubmitting = true;
		try {
			await onSubmit(formData);
		} finally {
			isSubmitting = false;
		}
	};

	const handleFileChange = async (event: Event) => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		fileUploading = true;
		if (!file) {
			fileUploading = false;
			return;
		}

		const uploadFormData = new FormData();
		uploadFormData.append('file', file);

		try {
			const response = await api('/upload', {
				method: 'POST',
				body: uploadFormData,
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.message || 'File upload failed');
			}

			formData.providerConfig.uploadedFilePath = result.filePath;
			formData.providerConfig.uploadedFileName = file.name;
			fileUploading = false;
		} catch (error) {
			fileUploading = false;
			const message = error instanceof Error ? error.message : String(error);
			setAlert({
				type: 'error',
				title: $t('app.components.ingestion_source_form.upload_failed'),
				message,
				duration: 5000,
				show: true,
			});
		}
	};
</script>

<form onsubmit={handleSubmit} class="grid gap-4 py-4">
	<div class="grid grid-cols-4 items-center gap-4">
		<Label for="name" class="text-left">{$t('app.ingestions.name')}</Label>
		<Input id="name" bind:value={formData.name} class="col-span-3" />
	</div>
	<div class="grid grid-cols-4 items-center gap-4">
		<Label for="provider" class="text-left">{$t('app.ingestions.provider')}</Label>
		<Select.Root name="provider" bind:value={formData.provider} type="single">
			<Select.Trigger class="col-span-3">
				{triggerContent}
			</Select.Trigger>
			<Select.Content>
				{#each providerOptions as option}
					<Select.Item value={option.value}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	{#if formData.provider === 'google_workspace'}
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="serviceAccountKeyJson" class="text-left"
				>{$t('app.components.ingestion_source_form.service_account_key')}</Label
			>
			<Textarea
				placeholder={$t(
					'app.components.ingestion_source_form.service_account_key_placeholder'
				)}
				id="serviceAccountKeyJson"
				bind:value={formData.providerConfig.serviceAccountKeyJson}
				class="col-span-3 max-h-32"
			/>
		</div>
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="impersonatedAdminEmail" class="text-left"
				>{$t('app.components.ingestion_source_form.impersonated_admin_email')}</Label
			>
			<Input
				id="impersonatedAdminEmail"
				bind:value={formData.providerConfig.impersonatedAdminEmail}
				class="col-span-3"
			/>
		</div>
	{:else if formData.provider === 'microsoft_365'}
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="clientId" class="text-left"
				>{$t('app.components.ingestion_source_form.client_id')}</Label
			>
			<Input id="clientId" bind:value={formData.providerConfig.clientId} class="col-span-3" />
		</div>
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="clientSecret" class="text-left"
				>{$t('app.components.ingestion_source_form.client_secret')}</Label
			>
			<Input
				id="clientSecret"
				type="password"
				placeholder={$t('app.components.ingestion_source_form.client_secret_placeholder')}
				bind:value={formData.providerConfig.clientSecret}
				class="col-span-3"
			/>
		</div>
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="tenantId" class="text-left"
				>{$t('app.components.ingestion_source_form.tenant_id')}</Label
			>
			<Input id="tenantId" bind:value={formData.providerConfig.tenantId} class="col-span-3" />
		</div>
	{:else if formData.provider === 'generic_imap'}
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="host" class="text-left"
				>{$t('app.components.ingestion_source_form.host')}</Label
			>
			<Input id="host" bind:value={formData.providerConfig.host} class="col-span-3" />
		</div>
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="port" class="text-left"
				>{$t('app.components.ingestion_source_form.port')}</Label
			>
			<Input
				id="port"
				type="number"
				bind:value={formData.providerConfig.port}
				class="col-span-3"
			/>
		</div>
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="username" class="text-left"
				>{$t('app.components.ingestion_source_form.username')}</Label
			>
			<Input id="username" bind:value={formData.providerConfig.username} class="col-span-3" />
		</div>
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="password" class="text-left">{$t('app.auth.password')}</Label>
			<Input
				id="password"
				type="password"
				bind:value={formData.providerConfig.password}
				class="col-span-3"
			/>
		</div>
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="secure" class="text-left"
				>{$t('app.components.ingestion_source_form.use_tls')}</Label
			>
			<Checkbox id="secure" bind:checked={formData.providerConfig.secure} />
		</div>
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="allowInsecureCert" class="text-left"
				>{$t('app.components.ingestion_source_form.allow_insecure_cert')}</Label
			>
			<Checkbox
				id="allowInsecureCert"
				bind:checked={formData.providerConfig.allowInsecureCert}
			/>
		</div>
	{:else if formData.provider === 'pst_import'}
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="pst-file" class="text-left"
				>{$t('app.components.ingestion_source_form.pst_file')}</Label
			>
			<div class="col-span-3 flex flex-row items-center space-x-2">
				<Input
					id="pst-file"
					type="file"
					class=""
					accept=".pst"
					onchange={handleFileChange}
				/>
				{#if fileUploading}
					<span class=" text-primary animate-spin"><Loader2 /></span>
				{/if}
			</div>
		</div>
	{:else if formData.provider === 'eml_import'}
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="eml-file" class="text-left"
				>{$t('app.components.ingestion_source_form.eml_file')}</Label
			>
			<div class="col-span-3 flex flex-row items-center space-x-2">
				<Input
					id="eml-file"
					type="file"
					class=""
					accept=".zip"
					onchange={handleFileChange}
				/>
				{#if fileUploading}
					<span class=" text-primary animate-spin"><Loader2 /></span>
				{/if}
			</div>
		</div>
	{:else if formData.provider === 'mbox_import'}
		<div class="grid grid-cols-4 items-center gap-4">
			<Label for="mbox-file" class="text-left"
				>{$t('app.components.ingestion_source_form.mbox_file')}</Label
			>
			<div class="col-span-3 flex flex-row items-center space-x-2">
				<Input
					id="mbox-file"
					type="file"
					class=""
					accept=".mbox"
					onchange={handleFileChange}
				/>
				{#if fileUploading}
					<span class=" text-primary animate-spin"><Loader2 /></span>
				{/if}
			</div>
		</div>
	{/if}
	{#if formData.provider === 'google_workspace' || formData.provider === 'microsoft_365'}
		<Alert.Root>
			<Alert.Title>{$t('app.components.ingestion_source_form.heads_up')}</Alert.Title>
			<Alert.Description>
				<div class="my-1">
					{@html $t('app.components.ingestion_source_form.org_wide_warning')}
				</div>
			</Alert.Description>
		</Alert.Root>
	{/if}
	<Dialog.Footer>
		<Button type="submit" disabled={isSubmitting || fileUploading}>
			{#if isSubmitting}
				{$t('app.components.common.submitting')}
			{:else}
				{$t('app.components.common.submit')}
			{/if}
		</Button>
	</Dialog.Footer>
</form>
