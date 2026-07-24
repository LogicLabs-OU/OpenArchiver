<script lang="ts">
	import type { SafeIngestionSource, CreateIngestionSourceDto } from '@open-archiver/types';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Progress } from '$lib/components/ui/progress';
	import { setAlert } from '$lib/components/custom/alert/alert-state.svelte';
	import { authStore } from '$lib/stores/auth.store';
	import { get } from 'svelte/store';
	import { Info, ChevronDown, CircleCheck, CircleX, X } from 'lucide-svelte';
	import tippy from 'tippy.js';
	import 'tippy.js/dist/tippy.css';
	import { t } from '$lib/translations';
	let {
		source = null,
		existingSources = [],
		onSubmit,
	}: {
		source?: SafeIngestionSource | null;
		/** Existing root ingestion sources for the merge dropdown (create mode only) */
		existingSources?: SafeIngestionSource[];
		onSubmit: (data: CreateIngestionSourceDto) => Promise<void>;
	} = $props();

	const providerOptions = [
		{
			value: 'generic_imap',
			label: $t('app.components.ingestion_source_form.provider_generic_imap'),
			disabled: false,
		},
		{
			value: 'google_workspace',
			label: $t('app.components.ingestion_source_form.provider_google_workspace'),
			disabled: false,
		},
		{
			value: 'microsoft_365',
			label: $t('app.components.ingestion_source_form.provider_microsoft_365'),
			disabled: false,
		},
		{
			value: 'pst_import',
			label: $t('app.components.ingestion_source_form.provider_pst_import'),
			disabled: false,
		},
		{
			value: 'eml_import',
			label: $t('app.components.ingestion_source_form.provider_eml_import'),
			disabled: false,
		},
		{
			value: 'mbox_import',
			label: $t('app.components.ingestion_source_form.provider_mbox_import'),
			disabled: false,
		},
		// smtp_journaling sources are created and managed via the Journaling page.
		// This entry exists only so that editing an existing smtp_journaling ingestion
		// source displays the correct provider label instead of falling back to the
		// first option. It is disabled to prevent users from selecting it when creating.
		{
			value: 'smtp_journaling',
			label: $t('app.components.ingestion_source_form.provider_smtp_journaling'),
			disabled: true,
		},
	];

	/** Only show root sources (not children) in the merge dropdown */
	const mergeableRootSources = $derived(existingSources.filter((s) => !s.mergedIntoId));

	let formData: CreateIngestionSourceDto = $state({
		name: source?.name ?? '',
		provider: source?.provider ?? 'generic_imap',
		providerConfig: {
			type: source?.provider ?? 'generic_imap',
			secure: true,
			allowInsecureCert: false,
		},
		preserveOriginalFile: source?.preserveOriginalFile ?? false,
	});

	$effect(() => {
		formData.providerConfig.type = formData.provider;
	});

	const triggerContent = $derived(
		providerOptions.find((p) => p.value === formData.provider)?.label ??
			$t('app.components.ingestion_source_form.select_provider')
	);

	let isSubmitting = $state(false);
	let showAdvanced = $state(false);
	let mergeEnabled = $state(false);

	// Upload state for the file-based providers (PST/EML/Mbox). Only one provider block
	// is rendered at a time, so a single shared set of state is sufficient.
	type UploadState = 'idle' | 'uploading' | 'success' | 'error';
	let uploadState = $state<UploadState>('idle');
	let uploadProgress = $state(0);
	let uploadError = $state('');
	let activeXhr: XMLHttpRequest | null = null;
	// providerConfig is a union across provider types; the uploaded* fields only exist on the
	// file-based variants, so read them through a cast for the success display.
	const uploadedFileName = $derived(
		(formData.providerConfig as { uploadedFileName?: string }).uploadedFileName ?? ''
	);
	const uploadedFilePath = $derived(
		(formData.providerConfig as { uploadedFilePath?: string }).uploadedFilePath ?? ''
	);

	/** When merge is toggled off, clear the mergedIntoId */
	$effect(() => {
		if (!mergeEnabled) {
			delete formData.mergedIntoId;
		}
	});

	let importMethod = $state<'upload' | 'local'>('upload');

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
			// Switching to local path abandons any in-flight/finished upload.
			resetUpload();
		}
	});

	/** Clears upload state and aborts any in-flight upload. */
	const resetUpload = () => {
		activeXhr?.abort();
		activeXhr = null;
		uploadState = 'idle';
		uploadProgress = 0;
		uploadError = '';
		if ('uploadedFilePath' in formData.providerConfig) {
			delete formData.providerConfig.uploadedFilePath;
		}
		if ('uploadedFileName' in formData.providerConfig) {
			delete formData.providerConfig.uploadedFileName;
		}
	};

	/** Cancels an in-flight upload (triggered by the user's Cancel button). */
	const cancelUpload = () => {
		activeXhr?.abort();
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

	const handleFileChange = (event: Event) => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) {
			return;
		}
		// Reset the input immediately so the same file can be re-selected after a cancel/error.
		target.value = '';
		uploadFile(file);
	};

	/**
	 * Uploads a chosen file via XMLHttpRequest so we can report progress and support cancel —
	 * fetch() exposes neither. Mirrors the auth/URL of the api() helper (Bearer token, the
	 * /api/v1 proxy). Any failure is surfaced both inline (persistent) and as a toast so the
	 * user is never left thinking a failed upload succeeded.
	 */
	const uploadFile = (file: File) => {
		const uploadFormData = new FormData();
		uploadFormData.append('file', file);

		const xhr = new XMLHttpRequest();
		activeXhr = xhr;
		uploadState = 'uploading';
		uploadProgress = 0;
		uploadError = '';

		const failUpload = (message: string) => {
			activeXhr = null;
			uploadState = 'error';
			uploadError = message;
			setAlert({
				type: 'error',
				title: $t('app.components.ingestion_source_form.upload_failed'),
				message,
				duration: 5000,
				show: true,
			});
		};

		xhr.upload.addEventListener('progress', (e) => {
			if (e.lengthComputable) {
				uploadProgress = Math.round((e.loaded / e.total) * 100);
			}
		});

		xhr.addEventListener('load', () => {
			activeXhr = null;
			// The response may not be valid JSON (e.g. the proxy returned an HTML error page).
			let result: Record<string, string> = {};
			try {
				result = JSON.parse(xhr.responseText);
			} catch {
				if (xhr.status < 200 || xhr.status >= 300) {
					failUpload($t('app.components.ingestion_source_form.upload_network_error'));
					return;
				}
			}

			if (xhr.status < 200 || xhr.status >= 300) {
				failUpload(
					result.message ||
						result.error ||
						$t('app.components.ingestion_source_form.upload_failed')
				);
				return;
			}

			formData.providerConfig.uploadedFilePath = result.filePath;
			formData.providerConfig.uploadedFileName = file.name;
			uploadState = 'success';
			uploadProgress = 100;
		});

		xhr.addEventListener('error', () => {
			failUpload($t('app.components.ingestion_source_form.upload_network_error'));
		});
		xhr.addEventListener('timeout', () => {
			failUpload($t('app.components.ingestion_source_form.upload_network_error'));
		});
		xhr.addEventListener('abort', () => {
			// User-initiated cancel: return to the idle picker with no partial state.
			activeXhr = null;
			uploadState = 'idle';
			uploadProgress = 0;
			uploadError = '';
		});

		const { accessToken } = get(authStore);
		xhr.open('POST', '/api/v1/upload');
		if (accessToken) {
			xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
		}
		xhr.send(uploadFormData);
	};

	const mergeTriggerContent = $derived(
		formData.mergedIntoId
			? (mergeableRootSources.find((s) => s.id === formData.mergedIntoId)?.name ??
					$t('app.components.ingestion_source_form.merge_into_select'))
			: $t('app.components.ingestion_source_form.merge_into_select')
	);
</script>

<!--
	Shared upload field for the file-based providers (PST/EML/Mbox): file picker with live
	progress + cancel, a persistent success panel (file name + storage path), and a persistent
	error panel with the failure reason. Only one provider block renders at a time, so the
	shared upload state drives whichever field is visible.
-->
{#snippet uploadField(id: string, accept: string, labelKey: string)}
	<div class="grid grid-cols-4 items-start gap-4">
		<Label for={id} class="pt-2 text-left">{$t(labelKey)}</Label>
		<div class="col-span-3 space-y-2">
			{#if uploadState === 'uploading'}
				<div class="flex items-center gap-3">
					<Progress value={uploadProgress} class="flex-1" />
					<span class="text-muted-foreground w-10 text-right text-sm tabular-nums">
						{uploadProgress}%
					</span>
					<Button type="button" variant="outline" size="sm" onclick={cancelUpload}>
						<X class="mr-1 size-4" />
						{$t('app.components.ingestion_source_form.upload_cancel')}
					</Button>
				</div>
			{:else if uploadState === 'success'}
				<Alert.Root>
					<CircleCheck class="size-4 text-green-600" />
					<Alert.Title>
						{$t('app.components.ingestion_source_form.upload_complete')}
					</Alert.Title>
					<Alert.Description>
						<div class="space-y-1">
							<div>
								<span class="text-muted-foreground">
									{$t('app.components.ingestion_source_form.upload_file_label')}:
								</span>
								{uploadedFileName}
							</div>
							<div class="break-all">
								<span class="text-muted-foreground">
									{$t('app.components.ingestion_source_form.upload_path_label')}:
								</span>
								<span class="font-mono text-xs">{uploadedFilePath}</span>
							</div>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="mt-2 h-7 px-2"
							onclick={resetUpload}
						>
							{$t('app.components.ingestion_source_form.upload_replace')}
						</Button>
					</Alert.Description>
				</Alert.Root>
			{:else}
				{#if uploadState === 'error'}
					<Alert.Root variant="destructive">
						<CircleX class="size-4" />
						<Alert.Title>
							{$t('app.components.ingestion_source_form.upload_failed')}
						</Alert.Title>
						<Alert.Description>{uploadError}</Alert.Description>
					</Alert.Root>
				{/if}
				<Input {id} type="file" {accept} onchange={handleFileChange} />
			{/if}
		</div>
	</div>
{/snippet}

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
					<Select.Item value={option.value} disabled={option.disabled}
						>{option.label}</Select.Item
					>
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
			{@render uploadField(
				'pst-file',
				'.pst',
				'app.components.ingestion_source_form.pst_file'
			)}
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
			{@render uploadField(
				'eml-file',
				'.zip',
				'app.components.ingestion_source_form.eml_file'
			)}
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
			{@render uploadField(
				'mbox-file',
				'.mbox',
				'app.components.ingestion_source_form.mbox_file'
			)}
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

	<!-- Advanced Options (collapsible) -->
	<div class="border-t pt-2">
		<button
			type="button"
			class="text-muted-foreground flex w-full cursor-pointer items-center gap-1 text-sm font-medium"
			onclick={() => (showAdvanced = !showAdvanced)}
		>
			<ChevronDown class="h-4 w-4 transition-transform {showAdvanced ? 'rotate-180' : ''}" />
			{$t('app.components.ingestion_source_form.advanced_options')}
		</button>

		{#if showAdvanced}
			<div class="mt-3 grid gap-4">
				<div class="grid grid-cols-4 items-center gap-4">
					<div class="flex items-center gap-1 text-left">
						<Label for="preserveOriginalFile"
							>{$t(
								'app.components.ingestion_source_form.preserve_original_file'
							)}</Label
						>
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
					<Checkbox
						id="preserveOriginalFile"
						bind:checked={formData.preserveOriginalFile}
					/>
				</div>

				<!-- Merge into existing ingestion (create mode only, when existing sources exist) -->
				{#if !source && mergeableRootSources.length > 0}
					<div class="grid grid-cols-4 items-center gap-4">
						<div class="flex items-center gap-1 text-left">
							<Label for="mergeEnabled"
								>{$t('app.components.ingestion_source_form.merge_into')}</Label
							>
							<span
								use:tippy={{
									allowHTML: true,
									content: $t(
										'app.components.ingestion_source_form.merge_into_tooltip'
									),
									interactive: true,
									delay: 500,
								}}
								class="text-muted-foreground cursor-help"
							>
								<Info class="h-4 w-4" />
							</span>
						</div>
						<Checkbox id="mergeEnabled" bind:checked={mergeEnabled} />
					</div>

					{#if mergeEnabled}
						<div class="grid grid-cols-4 items-center gap-4">
							<div class="col-span-1"></div>
							<div class="col-span-3">
								<Select.Root
									name="mergedIntoId"
									bind:value={formData.mergedIntoId}
									type="single"
								>
									<Select.Trigger class="w-full">
										{mergeTriggerContent}
									</Select.Trigger>
									<Select.Content>
										{#each mergeableRootSources as rootSource}
											<Select.Item value={rootSource.id}>
												{rootSource.name} ({rootSource.provider
													.split('_')
													.join(' ')})
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<Dialog.Footer>
		<Button type="submit" disabled={isSubmitting || uploadState === 'uploading'}>
			{#if isSubmitting}
				{$t('app.components.common.submitting')}
			{:else}
				{$t('app.components.common.submit')}
			{/if}
		</Button>
	</Dialog.Footer>
</form>
