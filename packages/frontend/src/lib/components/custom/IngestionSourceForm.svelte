<script lang="ts">
	import type { IngestionSource, CreateIngestionSourceDto } from '@open-archiver/types';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
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
			value: 'google_oauth',
			label: 'Gmail (Connect with Google)',
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

	let importMethod = $state<'upload' | 'local'>(
		source?.credentials &&
			'localFilePath' in source.credentials &&
			source.credentials.localFilePath
			? 'local'
			: 'upload'
	);

	$effect(() => {
		if (importMethod === 'upload') {
			if ('localFilePath' in formData.providerConfig) {
				delete formData.providerConfig.localFilePath;
			}
		} else {
			if ('uploadedFilePath' in formData.providerConfig) {
				delete formData.providerConfig.uploadedFilePath;
			}
			if ('uploadedFileName' in formData.providerConfig) {
				delete formData.providerConfig.uploadedFileName;
			}
		}
	});

	const handleGoogleConnect = async () => {
		if (!formData.name.trim()) {
			setAlert({
				type: 'error',
				title: 'Name required',
				message: 'Please enter a name for this connection before connecting.',
				duration: 4000,
				show: true,
			});
			return;
		}
		try {
			const res = await api(`/oauth/google/authorize?name=${encodeURIComponent(formData.name)}`);
			if (!res.ok) throw new Error('Failed to initiate Google OAuth.');
			const { url } = await res.json();
			window.location.href = url;
		} catch (e) {
			setAlert({
				type: 'error',
				title: 'Connection failed',
				message: e instanceof Error ? e.message : 'Could not start Google OAuth flow.',
				duration: 5000,
				show: true,
			});
		}
	};

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

			// Safely parse the response body — it may not be valid JSON
			// (e.g. if the proxy rejected the request with an HTML error page)
			let result: Record<string, string>;
			try {
				result = await response.json();
			} catch {
				throw new Error($t('app.components.ingestion_source_form.upload_network_error'));
			}

			if (!response.ok) {
				throw new Error(
					result.message || $t('app.components.ingestion_source_form.upload_failed')
				);
			}

			formData.providerConfig.uploadedFilePath = result.filePath;
			formData.providerConfig.uploadedFileName = file.name;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setAlert({
				type: 'error',
				title: $t('app.components.ingestion_source_form.upload_failed'),
				message,
				duration: 5000,
				show: true,
			});
			// Reset file input so the user can retry with the same file
			target.value = '';
		} finally {
			fileUploading = false;
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
	{:else if formData.provider === 'google_oauth'}
		<div class="flex flex-col items-center gap-4 py-2">
			<p class="text-muted-foreground text-sm text-center">
				Click the button below to securely connect your Gmail account via Google OAuth.
				You will be redirected to Google to authorize access.
			</p>
			<button
				type="button"
				onclick={handleGoogleConnect}
				class="flex items-center gap-3 rounded-md border border-[#dadce0] bg-white px-4 py-2 text-sm font-medium text-[#3c4043] shadow-sm hover:bg-gray-50 transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="h-5 w-5">
					<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
					<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
					<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
					<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
				</svg>
				Sign in with Google
			</button>
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
		<div class="grid grid-cols-4 items-start gap-4">
			<Label class="pt-2 text-left"
				>{$t('app.components.ingestion_source_form.import_method')}</Label
			>
			<RadioGroup.Root bind:value={importMethod} class="col-span-3 flex flex-col space-y-1">
				<div class="flex items-center space-x-2">
					<RadioGroup.Item value="upload" id="pst-upload" />
					<Label for="pst-upload"
						>{$t('app.components.ingestion_source_form.upload_file')}</Label
					>
				</div>
				<div class="flex items-center space-x-2">
					<RadioGroup.Item value="local" id="pst-local" />
					<Label for="pst-local"
						>{$t('app.components.ingestion_source_form.local_path')}</Label
					>
				</div>
			</RadioGroup.Root>
		</div>

		{#if importMethod === 'upload'}
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
		{:else}
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="pst-local-path" class="text-left"
					>{$t('app.components.ingestion_source_form.local_file_path')}</Label
				>
				<Input
					id="pst-local-path"
					bind:value={formData.providerConfig.localFilePath}
					placeholder="/path/to/file.pst"
					class="col-span-3"
				/>
			</div>
		{/if}
	{:else if formData.provider === 'eml_import'}
		<div class="grid grid-cols-4 items-start gap-4">
			<Label class="pt-2 text-left"
				>{$t('app.components.ingestion_source_form.import_method')}</Label
			>
			<RadioGroup.Root bind:value={importMethod} class="col-span-3 flex flex-col space-y-1">
				<div class="flex items-center space-x-2">
					<RadioGroup.Item value="upload" id="eml-upload" />
					<Label for="eml-upload"
						>{$t('app.components.ingestion_source_form.upload_file')}</Label
					>
				</div>
				<div class="flex items-center space-x-2">
					<RadioGroup.Item value="local" id="eml-local" />
					<Label for="eml-local"
						>{$t('app.components.ingestion_source_form.local_path')}</Label
					>
				</div>
			</RadioGroup.Root>
		</div>

		{#if importMethod === 'upload'}
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
		{:else}
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="eml-local-path" class="text-left"
					>{$t('app.components.ingestion_source_form.local_file_path')}</Label
				>
				<Input
					id="eml-local-path"
					bind:value={formData.providerConfig.localFilePath}
					placeholder="/path/to/file.zip"
					class="col-span-3"
				/>
			</div>
		{/if}
	{:else if formData.provider === 'mbox_import'}
		<div class="grid grid-cols-4 items-start gap-4">
			<Label class="pt-2 text-left"
				>{$t('app.components.ingestion_source_form.import_method')}</Label
			>
			<RadioGroup.Root bind:value={importMethod} class="col-span-3 flex flex-col space-y-1">
				<div class="flex items-center space-x-2">
					<RadioGroup.Item value="upload" id="mbox-upload" />
					<Label for="mbox-upload"
						>{$t('app.components.ingestion_source_form.upload_file')}</Label
					>
				</div>
				<div class="flex items-center space-x-2">
					<RadioGroup.Item value="local" id="mbox-local" />
					<Label for="mbox-local"
						>{$t('app.components.ingestion_source_form.local_path')}</Label
					>
				</div>
			</RadioGroup.Root>
		</div>

		{#if importMethod === 'upload'}
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
		{:else}
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="mbox-local-path" class="text-left"
					>{$t('app.components.ingestion_source_form.local_file_path')}</Label
				>
				<Input
					id="mbox-local-path"
					bind:value={formData.providerConfig.localFilePath}
					placeholder="/path/to/file.mbox"
					class="col-span-3"
				/>
			</div>
		{/if}
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
	{#if formData.provider !== 'google_oauth'}
		<Dialog.Footer>
			<Button type="submit" disabled={isSubmitting || fileUploading}>
				{#if isSubmitting}
					{$t('app.components.common.submitting')}
				{:else}
					{$t('app.components.common.submit')}
				{/if}
			</Button>
		</Dialog.Footer>
	{/if}
</form>
